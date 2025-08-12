#include <ApplicationServices/ApplicationServices.h>
#include <IOKit/hid/IOHIDManager.h>
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h> // For usleep
#include <signal.h>
#include <dispatch/dispatch.h>
#include <Foundation/Foundation.h>
#include <AppKit/AppKit.h>

// Forward declarations for functions defined later in this file
static void requireAX(void);
static void cmdV(void);

// ==== Accessibility (AX) paste verification utilities ====
// We keep Cmd+V for insertion, and use AX to read/observe for verification.

typedef struct {
    AXObserverRef observer;
    AXUIElementRef appEl;
    AXUIElementRef focusedEl;
    volatile int valueChangedNotified;
    volatile int selectionChangedNotified;
} AXWatch;

static AXUIElementRef ax_focused_app_element(void) {
    // Prefer app-specific path via NSWorkspace (more reliable than system-wide attribute)
    @autoreleasepool {
        NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (front) {
            pid_t pid = front.processIdentifier;
            if (pid > 0) {
                AXUIElementRef appEl = AXUIElementCreateApplication(pid);
                if (appEl) return appEl;
            }
        }
    }
    // Fallback to system-wide attribute if NSWorkspace path fails
    AXUIElementRef sys = AXUIElementCreateSystemWide();
    if (!sys) return NULL;
    AXUIElementRef appEl = NULL;
    if (AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute, (CFTypeRef *)&appEl) != kAXErrorSuccess) {
        CFRelease(sys);
        return NULL;
    }
    CFRelease(sys);
    return appEl; // caller CFRelease
}

static AXUIElementRef ax_focused_element_from_app(AXUIElementRef appEl) {
    if (!appEl) return NULL;
    AXUIElementRef el = NULL;
    if (AXUIElementCopyAttributeValue(appEl, kAXFocusedUIElementAttribute, (CFTypeRef *)&el) != kAXErrorSuccess) {
        return NULL;
    }
    return el; // caller CFRelease
}

static bool ax_is_secure(AXUIElementRef el) {
    if (!el) return false;
    CFTypeRef subrole = NULL;
    if (AXUIElementCopyAttributeValue(el, kAXSubroleAttribute, &subrole) == kAXErrorSuccess && subrole) {
        bool secure = (CFGetTypeID(subrole) == CFStringGetTypeID()) &&
                      (CFStringCompare((CFStringRef)subrole, CFSTR("AXSecureTextField"), 0) == kCFCompareEqualTo);
        CFRelease(subrole);
        return secure;
    }
    return false;
}

static bool ax_get_selected_range_cf(AXUIElementRef el, CFRange *out) {
    if (!el || !out) return false;
    AXValueRef v = NULL;
    if (AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute, (CFTypeRef *)&v) == kAXErrorSuccess && v) {
        bool ok = false;
        if (AXValueGetType(v) == kAXValueCFRangeType) {
            ok = AXValueGetValue(v, kAXValueCFRangeType, out);
        }
        CFRelease(v);
        return ok;
    }
    return false; // marker-only editors not handled here
}

static CFStringRef ax_copy_value(AXUIElementRef el) {
    if (!el) return NULL;
    CFTypeRef v = NULL;
    if (AXUIElementCopyAttributeValue(el, kAXValueAttribute, &v) == kAXErrorSuccess && v) {
        if (CFGetTypeID(v) == CFStringGetTypeID()) {
            return (CFStringRef)v; // caller CFRelease
        }
        CFRelease(v);
    }
    return NULL;
}

static CFStringRef cfstring_from_utf8(const char *s) {
    if (!s) return NULL;
    return CFStringCreateWithCString(kCFAllocatorDefault, s, kCFStringEncodingUTF8);
}

static void print_cfstring_truncated(const char *label, CFStringRef s, CFIndex limit) {
    if (!label) label = "";
    if (!s) {
        printf("%s: (null)\n", label); return;
    }
    CFIndex len = CFStringGetLength(s);
    CFIndex take = (limit > 0 && limit < len) ? limit : len;
    CFStringRef slice = (take == len) ? CFRetain(s) : CFStringCreateWithSubstring(kCFAllocatorDefault, s, CFRangeMake(0, take));
    if (!slice) { printf("%s: (slice-null)\n", label); return; }
    CFIndex max = CFStringGetMaximumSizeForEncoding(CFStringGetLength(slice), kCFStringEncodingUTF8) + 1;
    char *buf = (char *)malloc((size_t)max);
    if (buf && CFStringGetCString(slice, buf, max, kCFStringEncodingUTF8)) {
        printf("%s: %s\n", label, buf);
    } else {
        printf("%s: (unprintable)\n", label);
    }
    if (buf) free(buf);
    CFRelease(slice);
}

static CFStringRef cfstring_substring_safe(CFStringRef s, CFRange r) {
    if (!s) return NULL;
    CFIndex len = CFStringGetLength(s);
    if (r.location < 0) r.location = 0;
    if (r.length < 0) r.length = 0;
    if (r.location > len) r.location = len;
    if (r.location + r.length > len) r.length = len - r.location;
    return CFStringCreateWithSubstring(kCFAllocatorDefault, s, r);
}

static CFStringRef cfstring_replace_range(CFStringRef base, CFRange r, CFStringRef insert) {
    if (!base) {
        return insert ? CFRetain(insert) : CFStringCreateWithCString(kCFAllocatorDefault, "", kCFStringEncodingUTF8);
    }
    CFMutableStringRef m = CFStringCreateMutableCopy(kCFAllocatorDefault, 0, base);
    if (!m) return NULL;
    CFStringRef repl = insert ? insert : CFSTR("");
    CFStringReplace(m, r, repl);
    return m; // caller CFRelease
}

static bool cfstring_equals(CFStringRef a, CFStringRef b) {
    if (a == b) return true;
    if (!a || !b) return false;
    return CFStringCompare(a, b, 0) == kCFCompareEqualTo;
}

static void ax_observer_cb(AXObserverRef obs, AXUIElementRef element, CFStringRef notification, void *refcon) {
    (void)obs; (void)element;
    AXWatch *w = (AXWatch *)refcon;
    if (!notification || !w) return;
    if (CFStringCompare(notification, kAXValueChangedNotification, 0) == kCFCompareEqualTo) {
        w->valueChangedNotified = 1;
        puts("ax:AXValueChanged"); fflush(stdout);
    } else if (CFStringCompare(notification, kAXSelectedTextChangedNotification, 0) == kCFCompareEqualTo) {
        w->selectionChangedNotified = 1;
        puts("ax:AXSelectedTextChanged"); fflush(stdout);
    } else if (CFStringCompare(notification, kAXFocusedUIElementChangedNotification, 0) == kCFCompareEqualTo) {
        puts("ax:AXFocusedUIElementChanged"); fflush(stdout);
    }
}

static bool ax_watch_start(AXWatch *w, AXUIElementRef appEl, AXUIElementRef focusedEl) {
    if (!w || !appEl || !focusedEl) return false;
    memset(w, 0, sizeof(*w));
    pid_t pid = 0;
    if (AXUIElementGetPid(focusedEl, &pid) != kAXErrorSuccess || pid == 0) return false;
    AXObserverRef obs = NULL;
    if (AXObserverCreate(pid, ax_observer_cb, &obs) != kAXErrorSuccess || !obs) return false;
    // Retain elements for lifetime of watch
    w->observer = obs;
    w->appEl = CFRetain(appEl);
    w->focusedEl = CFRetain(focusedEl);
    AXObserverAddNotification(obs, focusedEl, kAXValueChangedNotification, w);
    AXObserverAddNotification(obs, focusedEl, kAXSelectedTextChangedNotification, w);
    AXObserverAddNotification(obs, appEl, kAXFocusedUIElementChangedNotification, w);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(obs), kCFRunLoopCommonModes);
    return true;
}

static void ax_watch_stop(AXWatch *w) {
    if (!w) return;
    if (w->observer) {
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(w->observer), kCFRunLoopCommonModes);
        CFRelease(w->observer);
        w->observer = NULL;
    }
    if (w->appEl) { CFRelease(w->appEl); w->appEl = NULL; }
    if (w->focusedEl) { CFRelease(w->focusedEl); w->focusedEl = NULL; }
}

static int paste_and_verify_core(const char *payload_utf8, int timeout_ms) {
    requireAX();

    // Resolve focused app and element (app-specific path is more reliable than system-wide element alone)
    AXUIElementRef appEl = ax_focused_app_element();
    if (!appEl) {
        puts("paste:err:no-app"); fflush(stdout);
        return 2;
    }
    AXUIElementRef el = ax_focused_element_from_app(appEl);
    if (!el) {
        CFRelease(appEl);
        puts("paste:err:no-focus"); fflush(stdout);
        return 2;
    }
    if (ax_is_secure(el)) {
        CFRelease(el); CFRelease(appEl);
        puts("paste:err:secure-field"); fflush(stdout);
        return 3;
    }

    // PRE state
    CFStringRef preVal = ax_copy_value(el);
    CFRange preSel = {0,0};
    bool haveSel = ax_get_selected_range_cf(el, &preSel);
    if (!preVal || !haveSel) {
        if (preVal) CFRelease(preVal);
        CFRelease(el); CFRelease(appEl);
        puts("paste:err:unreadable"); fflush(stdout);
        return 4;
    }

    // Start observer before cmdV
    AXWatch watch = {0};
    ax_watch_start(&watch, appEl, el);

    // Paste via existing keystroke simulation
    cmdV();

    // Wait for notification or timeout; pump runloop so observer fires
    const int step_ms = 20;
    int waited = 0;
    while (waited < timeout_ms && !watch.valueChangedNotified) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, (CFTimeInterval)step_ms/1000.0, false);
        usleep(step_ms * 1000);
        waited += step_ms;
    }

    // POST state
    CFStringRef postVal = ax_copy_value(el);
    CFRange postSel = {0,0};
    ax_get_selected_range_cf(el, &postSel);

    CFStringRef payload = cfstring_from_utf8(payload_utf8 ? payload_utf8 : "");
    CFStringRef expected = cfstring_replace_range(preVal, preSel, payload);

    int rc = 0;
    if (!postVal) {
        puts("paste:verify:unknown"); rc = 10;
    } else if (cfstring_equals(postVal, expected)) {
        CFIndex payloadLen = payload ? CFStringGetLength(payload) : 0;
        printf("paste:ok:%ld:%ld\n", (long)preSel.location, (long)payloadLen);
        rc = 0;
    } else {
        puts("paste:mismatch"); rc = 11;
    }
    fflush(stdout);

    if (preVal) CFRelease(preVal);
    if (postVal) CFRelease(postVal);
    if (payload) CFRelease(payload);
    if (expected) CFRelease(expected);
    ax_watch_stop(&watch);
    CFRelease(el);
    CFRelease(appEl);
    return rc;
}

static int inspect_text_core(int context_chars) {
    requireAX();
    AXUIElementRef appEl = ax_focused_app_element();
    if (!appEl) { puts("read:err:no-app"); fflush(stdout); return 2; }
    AXUIElementRef el = ax_focused_element_from_app(appEl);
    if (!el) { CFRelease(appEl); puts("read:err:no-focus"); fflush(stdout); return 2; }
    if (ax_is_secure(el)) { CFRelease(el); CFRelease(appEl); puts("read:err:secure-field"); fflush(stdout); return 3; }

    CFStringRef value = ax_copy_value(el);
    CFRange sel = {0,0};
    bool haveSel = ax_get_selected_range_cf(el, &sel);
    if (!value) { CFRelease(el); CFRelease(appEl); puts("read:err:unreadable"); fflush(stdout); return 4; }

    CFIndex len = CFStringGetLength(value);
    CFIndex beforeStart = sel.location - (context_chars > 0 ? context_chars : 32);
    if (beforeStart < 0) beforeStart = 0;
    CFIndex afterEnd = sel.location + sel.length + (context_chars > 0 ? context_chars : 32);
    if (afterEnd > len) afterEnd = len;

    CFStringRef selectedText = haveSel ? cfstring_substring_safe(value, sel) : NULL;
    CFStringRef contextSlice = cfstring_substring_safe(value, CFRangeMake(beforeStart, afterEnd - beforeStart));

    printf("read:ok\n");
    printf("selectedRange:%ld:%ld\n", (long)sel.location, (long)sel.length);
    print_cfstring_truncated("selectedText", selectedText, 512);
    print_cfstring_truncated("context", contextSlice, 512);
    printf("valueLength:%ld\n", (long)len);
    fflush(stdout);

    if (selectedText) CFRelease(selectedText);
    if (contextSlice) CFRelease(contextSlice);
    if (value) CFRelease(value);
    CFRelease(el);
    CFRelease(appEl);
    return 0;
}

static void handle_signal(int sig) {
    fprintf(stderr, "[SIG] caught %d – exiting\n", sig);
    exit(0);                          // guarantees `close` event in Node
}

static void watch_parent(void) {
    pid_t ppid = getppid();           // the Electron process
    dispatch_source_t src =
        dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC,
                               ppid,
                               DISPATCH_PROC_EXIT,
                               dispatch_get_main_queue());
    dispatch_source_set_event_handler(src, ^{
        fprintf(stderr, "[PARENT] died – exiting helper\n");
        exit(0);
    });
    dispatch_resume(src);
}

// For older SDKs that may not have these defined yet.
#ifndef kIOHIDRequestTypeListenEvent
#define kIOHIDRequestTypeListenEvent 1
#endif

// For older SDKs that may not have these defined yet.
#ifndef IOHIDAccessType
typedef enum {
    kIOHIDAccessTypeGranted = 0,
    kIOHIDAccessTypeDenied = 1,
    kIOHIDAccessTypeUnknown = 2
} IOHIDAccessType;
#endif

// Declare the function for older SDKs
extern IOReturn IOHIDRequestAccess(uint32_t requestType);

// Declare IOHIDCheckAccess for permission checking
extern IOHIDAccessType IOHIDCheckAccess(uint32_t requestType);

// For older SDKs that may not have these defined yet.
#ifndef kCGListenEventAccessGranted
#define kCGListenEventAccessGranted (1)
#endif

#define FN_MASK kCGEventFlagMaskSecondaryFn // 0x00800000

// Modern function to check Input Monitoring permissions using IOHIDManager
bool check_input_monitoring_permission() {
    // Use IOHIDCheckAccess for accurate permission checking on all supported macOS versions
    return IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted;
}

// NEW: Proper Input Monitoring request function using CoreGraphics API
static bool request_input_monitoring(void) {
    // Don't flash the dialog twice - check if already authorized
    if (CGPreflightListenEventAccess()) {
        fprintf(stderr, "[IM] Already authorized\n");
        return true; // already authorized
    }

    // This will show the permission dialog and register the app in System Settings
    bool ok = CGRequestListenEventAccess(); // shows the alert
    if (!ok) {
        fprintf(stderr, "[IM] User clicked 'Deny' or dialog failed\n");
    } else {
        fprintf(stderr, "[IM] Permission granted\n");
    }
    return ok;
}

// Function to register the app in Input Monitoring settings
bool register_input_monitoring() {
    // Use the new proper request function
    return request_input_monitoring();
}

// Pre-flight check for permissions using modern APIs
bool check_permissions() {
    if (!check_input_monitoring_permission()) {
        puts("perm-denied");
        fflush(stdout); // Ensure the message is sent immediately
        return false;
    }
    return true;
}

CGEventRef cb(CGEventTapProxy proxy, CGEventType t, CGEventRef e, void *ctx) {
    if (t == kCGEventFlagsChanged) {
        bool *prev = (bool *)ctx;
        bool now = (CGEventGetFlags(e) & FN_MASK) != 0;
        if (now && !*prev) {
            puts("down");
            fflush(stdout);
        }
        if (!now && *prev) {
            puts("up");
            fflush(stdout);
        }
        *prev = now;
    }
    return e;
}

// Asks for Accessibility permissions and provides explicit logging.
static void requireAX(void) {
    CFDictionaryRef opts = CFDictionaryCreate(
        kCFAllocatorDefault,
        (const void **)&kAXTrustedCheckOptionPrompt,
        (const void *[]){ kCFBooleanTrue },
        1, &kCFCopyStringDictionaryKeyCallBacks,
           &kCFTypeDictionaryValueCallBacks);

    bool isTrusted = AXIsProcessTrustedWithOptions(opts);
    CFRelease(opts);

    if (!isTrusted) {
        // This will now appear in our Electron logs.
        fprintf(stderr, "[AX] Accessibility permissions are NOT granted. Prompt should be showing.\n");
        exit(1);
    }
    // And so will this.
    fprintf(stdout, "[AX] Accessibility permissions are granted.\n");
}

// Sends a robust, correct 4-event sequence for Command-V with delays.
static void cmdV(void) {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);

    const CGKeyCode kVK_COMMAND = 0x37;
    const CGKeyCode kVK_V = 0x09;

    CGEventRef cmdDown = CGEventCreateKeyboardEvent(src, kVK_COMMAND, true);
    CGEventRef vDown   = CGEventCreateKeyboardEvent(src, kVK_V, true);
    CGEventSetFlags(vDown, kCGEventFlagMaskCommand);
    CGEventRef vUp     = CGEventCreateKeyboardEvent(src, kVK_V, false);
    CGEventSetFlags(vUp, kCGEventFlagMaskCommand);
    CGEventRef cmdUp   = CGEventCreateKeyboardEvent(src, kVK_COMMAND, false);

    // Post all four events with small delays between them.
    CGEventPost(kCGHIDEventTap, cmdDown);
    usleep(10000); // 10ms
    CGEventPost(kCGHIDEventTap, vDown);
    usleep(10000);
    CGEventPost(kCGHIDEventTap, vUp);
    usleep(10000);
    CGEventPost(kCGHIDEventTap, cmdUp);

    CFRelease(cmdDown);
    CFRelease(vDown);
    CFRelease(vUp);
    CFRelease(cmdUp);
    CFRelease(src);
}

int main(int argc, char *argv[]) {
    signal(SIGTERM, handle_signal);   // respond to normal shutdown
    signal(SIGINT,  handle_signal);
    watch_parent();                   // respond to crashes / force-quit
    if (argc > 1 && strcmp(argv[1], "--mode=paste") == 0) {
        requireAX();
        cmdV();
        return 0;
    }
    // New: paste and verify with AX (reads/observes)
    if (argc > 1 && strcmp(argv[1], "--paste-and-verify") == 0) {
        // The UI should set the clipboard and pass the payload (optional but recommended for exact comparison)
        const char *payload = NULL;
        if (argc > 2) payload = argv[2];
        int code = paste_and_verify_core(payload, 700 /* ms */);
        return code;
    }
    if (argc > 1 && strcmp(argv[1], "--inspect-text") == 0) {
        int ctx = 32;
        if (argc > 2) {
            int parsed = atoi(argv[2]);
            if (parsed > 0 && parsed < 2048) ctx = parsed;
        }
        return inspect_text_core(ctx);
    }
    
    // NEW: Add support for requesting Input Monitoring permission
    if (argc > 1 && strcmp(argv[1], "--ask-im") == 0) {
        bool granted = request_input_monitoring();
        if (granted) {
            puts("im-granted");
            fflush(stdout);
            return 0;
        } else {
            puts("im-denied");
            fflush(stdout);
            return 1;
        }
    }
    
    // Add support for registering Input Monitoring permission
    if (argc > 1 && strcmp(argv[1], "--register-input-monitoring") == 0) {
        bool registered = register_input_monitoring();
        if (registered) {
            puts("registered-granted");
            fflush(stdout);
            return 0;
        } else {
            puts("registered-denied");
            fflush(stdout);
            return 1;
        }
    }
    
    // Add support for checking permissions using modern APIs
    if (argc > 1 && strcmp(argv[1], "--check-permissions") == 0) {
        // Check Accessibility permissions
        CFDictionaryRef opts = CFDictionaryCreate(
            kCFAllocatorDefault,
            (const void **)&kAXTrustedCheckOptionPrompt,
            (const void *[]){ kCFBooleanFalse }, // Don't show prompt
            1, &kCFCopyStringDictionaryKeyCallBacks,
               &kCFTypeDictionaryValueCallBacks);

        bool isTrusted = AXIsProcessTrustedWithOptions(opts);
        CFRelease(opts);
        
        // Check Input Monitoring permissions using modern API
        bool hasIMPermission = check_input_monitoring_permission();
        
        // Emit separate tokens for each permission type
        if (isTrusted) {
            puts("ax-granted");
        } else {
            puts("ax-denied");
        }
        
        if (hasIMPermission) {
            puts("im-granted");
        } else {
            puts("im-denied");
        }
        
        fflush(stdout);
        return 0;
    }

    if (!check_permissions()) {
        // If permissions are denied, we could loop and wait, but for this use
        // case, exiting and letting the main process handle it is cleaner.
        return 1;
    }

    bool s = false;
    CGEventMask m = 1ULL << kCGEventFlagsChanged;
    CFMachPortRef tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                                       kCGEventTapOptionDefault, m, cb, &s);

    if (!tap) {
        // Handle case where tap creation fails for other reasons
        return 1;
    }

    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(NULL, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    // Signal readiness to the Electron app
    puts("ready");
    fflush(stdout);
    CFRunLoopRun();
    return 0; // Should not be reached
}
