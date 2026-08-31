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

// Global debug flags (enabled via environment variables)
static bool g_debug_keys = false;
static bool g_debug_text = false;

// Forward declarations for functions defined later in this file
static void requireAX(void);
static void cmdV(void);
static void cmdC(void);

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

// Recursive helper to search for focusable elements in web content
static AXUIElementRef ax_find_text_input_recursive(AXUIElementRef element, int depth) {
    if (!element || depth > 10) return NULL; // Prevent infinite recursion
    
    // Check if this element looks like a text input
    CFTypeRef role = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role) == kAXErrorSuccess && role) {
        bool isTextInput = false;
        if (CFGetTypeID(role) == CFStringGetTypeID()) {
            CFStringRef roleStr = (CFStringRef)role;
            isTextInput = (CFStringCompare(roleStr, CFSTR("AXTextField"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXTextArea"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXComboBox"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXGroup"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXWebArea"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXScrollArea"), 0) == kCFCompareEqualTo) ||
                         (CFStringCompare(roleStr, CFSTR("AXTable"), 0) == kCFCompareEqualTo);
        }
        CFRelease(role);
        
        if (isTextInput) {
            // Check if it can accept input (has kAXValueAttribute or kAXSelectedTextRangeAttribute)
            CFTypeRef value = NULL;
            CFTypeRef selRange = NULL;
            bool canInput = (AXUIElementCopyAttributeValue(element, kAXValueAttribute, &value) == kAXErrorSuccess) ||
                           (AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &selRange) == kAXErrorSuccess);
            
            if (value) CFRelease(value);
            if (selRange) CFRelease(selRange);
            
            if (canInput) {
                return CFRetain(element); // Found a usable text input
            }
        }
    }
    
    // Recursively search children
    CFArrayRef children = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, (CFTypeRef *)&children) == kAXErrorSuccess && children) {
        CFIndex count = CFArrayGetCount(children);
        for (CFIndex i = 0; i < count; i++) {
            AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, i);
            AXUIElementRef found = ax_find_text_input_recursive(child, depth + 1);
            if (found) {
                CFRelease(children);
                return found; // caller CFRelease
            }
        }
        CFRelease(children);
    }
    
    return NULL;
}

static AXUIElementRef ax_focused_element_from_app(AXUIElementRef appEl) {
    if (!appEl) return NULL;
    
    // Strategy 1: Standard focus detection
    AXUIElementRef el = NULL;
    if (AXUIElementCopyAttributeValue(appEl, kAXFocusedUIElementAttribute, (CFTypeRef *)&el) == kAXErrorSuccess && el) {
        return el; // caller CFRelease
    }
    
    // Strategy 2: Search for text inputs in web content (browsers)
    AXUIElementRef webInput = ax_find_text_input_recursive(appEl, 0);
    if (webInput) {
        return webInput; // caller CFRelease
    }
    
    return NULL;
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

static void print_cfstring_base64(const char *label, CFStringRef s) {
    if (!label) label = "";
    if (!s) {
        printf("%sB64:\n", label);
        return;
    }
    CFDataRef data = CFStringCreateExternalRepresentation(
        kCFAllocatorDefault,
        s,
        kCFStringEncodingUTF8,
        0
    );
    if (!data) {
        printf("%sB64:\n", label);
        return;
    }
    @autoreleasepool {
        NSData *nsData = [NSData dataWithBytes:CFDataGetBytePtr(data)
                                         length:(NSUInteger)CFDataGetLength(data)];
        NSString *encoded = [nsData base64EncodedStringWithOptions:0];
        if (encoded) {
            printf("%sB64:%s\n", label, [encoded UTF8String]);
        } else {
            printf("%sB64:\n", label);
        }
    }
    CFRelease(data);
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

static CFStringRef cfstring_concat3(CFStringRef a, CFStringRef b, CFStringRef c) {
    if (!a && !b && !c) return NULL;
    CFMutableStringRef result = CFStringCreateMutable(kCFAllocatorDefault, 0);
    if (!result) return NULL;
    if (a) CFStringAppend(result, a);
    if (b) CFStringAppend(result, b);
    if (c) CFStringAppend(result, c);
    return result; // caller CFRelease
}

static CFStringRef ax_copy_selected_text_attribute(AXUIElementRef el) {
    if (!el) return NULL;
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(el, kAXSelectedTextAttribute, &value) == kAXErrorSuccess && value) {
        if (CFGetTypeID(value) == CFStringGetTypeID()) {
            return (CFStringRef)value; // caller CFRelease
        }
        CFRelease(value);
    }
    return NULL;
}

static CFStringRef ax_copy_string_for_range(AXUIElementRef el, CFRange range) {
    if (!el) return NULL;
    AXValueRef rangeValue = AXValueCreate(kAXValueCFRangeType, &range);
    if (!rangeValue) return NULL;

    CFTypeRef raw = NULL;
    CFStringRef result = NULL;
    AXError err = AXUIElementCopyParameterizedAttributeValue(
        el,
        kAXStringForRangeParameterizedAttribute,
        rangeValue,
        (CFTypeRef *)&raw
    );
    if (err == kAXErrorSuccess && raw && CFGetTypeID(raw) == CFStringGetTypeID()) {
        result = (CFStringRef)raw; // caller CFRelease
    } else if (raw) {
        CFRelease(raw);
    }

    CFRelease(rangeValue);
    return result;
}

static NSArray *clipboard_snapshot(NSPasteboard *pb) {
    if (!pb) return nil;
    NSArray *items = [pb pasteboardItems];
    if (!items) return @[];

    NSMutableArray *snapshot = [NSMutableArray arrayWithCapacity:[items count]];
    for (NSPasteboardItem *item in items) {
        NSMutableDictionary *entry = [NSMutableDictionary dictionary];
        for (NSPasteboardType type in [item types]) {
            NSData *data = [item dataForType:type];
            if (data) {
                entry[type] = [data copy];
            }
        }
        [snapshot addObject:entry];
    }

    return snapshot;
}

static void clipboard_restore(NSPasteboard *pb, NSArray *snapshot) {
    if (!pb) return;
    [pb clearContents];
    if (!snapshot || [snapshot count] == 0) return;

    NSMutableArray *items = [NSMutableArray arrayWithCapacity:[snapshot count]];
    for (NSDictionary *entry in snapshot) {
        NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
        for (NSString *type in entry) {
            NSData *data = entry[type];
            if (data) {
                [item setData:data forType:type];
            }
        }
        [items addObject:item];
    }

    if ([items count] > 0) {
        [pb writeObjects:items];
    }
}

static CFStringRef clipboard_copy_selected_text(bool *outSuccess) {
    @autoreleasepool {
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        if (!pb) {
            if (outSuccess) *outSuccess = false;
            return NULL;
        }

        NSInteger originalChangeCount = [pb changeCount];
        NSArray *snapshot = clipboard_snapshot(pb);

        cmdC();

        NSString *copied = nil;
        const useconds_t intervalUs = 30000; // 30ms polling window
        const int attempts = 6;              // ~180ms total budget
        for (int i = 0; i < attempts; i++) {
            usleep(intervalUs);
            if ([pb changeCount] != originalChangeCount) {
                copied = [pb stringForType:NSPasteboardTypeString];
                if (copied.length > 0) {
                    break;
                }
            }
        }

        CFStringRef result = NULL;
        if (copied.length > 0) {
            NSString *trimmed = [copied stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (trimmed.length > 0) {
                result = CFBridgingRetain([copied copy]);
            }
        }

        clipboard_restore(pb, snapshot);

        if (outSuccess) *outSuccess = (result != NULL);
        return result;
    }
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
    bool rangeValid = haveSel && sel.location >= 0 && sel.length >= 0;
    bool hasSelectionRange = rangeValid && sel.length > 0;

    CFStringRef selectedText = NULL;
    const char *source = "none";
    bool clipboardOk = false;

    // Always probe clipboard first - this handles Electron apps (Cursor, Raycast, VS Code, etc.)
    // that return {location:0, length:0} from AX API even when text IS selected.
    // The clipboard probe is non-invasive: it snapshots, attempts Cmd+C, polls for 180ms,
    // and restores the original clipboard. Since this happens during dictation start,
    // the latency is invisible to users.
    selectedText = clipboard_copy_selected_text(&clipboardOk);

    if (!clipboardOk && hasSelectionRange) {
        selectedText = ax_copy_selected_text_attribute(el);
        if (!selectedText) {
            selectedText = ax_copy_string_for_range(el, sel);
        }
    }

    if (clipboardOk) {
        // Successfully captured selection via clipboard
        source = "clipboard";
    } else if (hasSelectionRange) {
        // AX reported a selection but clipboard probe failed (rare edge case)
        source = "ax";
    } else {
        // No selection detected by either method
        source = "none";
    }

    CFRange outputRange = rangeValid ? sel : (CFRange){ -1, -1 };
    CFIndex len = value ? CFStringGetLength(value) : -1;

    printf("read:ok\n");
    printf("selectedRange:%ld:%ld\n", (long)outputRange.location, (long)outputRange.length);
    printf("selectionSource:%s\n", source);

    // Always output base64-encoded selectedText for edit mode to work
    // (base64 prevents issues with newlines/special chars in IPC parsing)
    print_cfstring_base64("selectedText", selectedText);

    CFStringRef context = NULL;
    if (rangeValid) {
        CFIndex contextStart = sel.location - context_chars;
        if (contextStart < 0) contextStart = 0;

        CFIndex selectionEnd = sel.location + sel.length;
        if (selectionEnd < sel.location) selectionEnd = sel.location;
        if (value && selectionEnd > len) selectionEnd = len;

        if (value) {
            CFIndex contextEnd = selectionEnd + context_chars;
            if (contextEnd > len) contextEnd = len;
            if (contextEnd < contextStart) contextEnd = contextStart;

            context = cfstring_substring_safe(value, CFRangeMake(contextStart, contextEnd - contextStart));
        } else {
            CFIndex beforeLength = sel.location - contextStart;
            if (beforeLength < 0) beforeLength = 0;

            CFStringRef beforeText = beforeLength > 0
                ? ax_copy_string_for_range(el, CFRangeMake(contextStart, beforeLength))
                : NULL;
            CFStringRef selectedContextText = sel.length > 0
                ? ax_copy_string_for_range(el, CFRangeMake(sel.location, sel.length))
                : NULL;
            CFStringRef afterText = ax_copy_string_for_range(el, CFRangeMake(selectionEnd, context_chars));

            context = cfstring_concat3(beforeText, selectedContextText, afterText);

            if (beforeText) CFRelease(beforeText);
            if (selectedContextText) CFRelease(selectedContextText);
            if (afterText) CFRelease(afterText);
        }
    }
    print_cfstring_base64("context", context);

    // PRIVACY: Only log plaintext/truncated versions when debugging
    if (g_debug_text) {
        print_cfstring_truncated("selectedText", selectedText, 512);
        print_cfstring_truncated("context", context, 512);
    }

    printf("valueLength:%ld\n", (long)len);
    fflush(stdout);

    if (selectedText) CFRelease(selectedText);
    if (context) CFRelease(context);
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

#define FN_MASK  kCGEventFlagMaskSecondaryFn // 0x00800000
#define OPT_MASK kCGEventFlagMaskAlternate   // Option/Alt modifier

// Some SDKs don't expose virtual keycodes; define the ones we need for Option
#ifndef kVK_Option
#define kVK_Option      58
#endif
#ifndef kVK_RightOption
#define kVK_RightOption 61
#endif

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

typedef struct {
    bool fn;
    bool optL;
    bool optR;
    bool cmdL;
    bool cmdR;
} KeyState;

// Some SDKs don't expose virtual keycodes; define the ones we need for Command
#ifndef kVK_Command
#define kVK_Command      55
#endif
#ifndef kVK_RightCommand
#define kVK_RightCommand 54
#endif

CGEventRef cb(CGEventTapProxy proxy, CGEventType t, CGEventRef e, void *ctx) {
    if (t == kCGEventFlagsChanged) {
        KeyState *state = (KeyState *)ctx;
        CGEventFlags flags = CGEventGetFlags(e);
        bool fnNow = (flags & FN_MASK) != 0;
        CGKeyCode code = (CGKeyCode)CGEventGetIntegerValueField(e, kCGKeyboardEventKeycode);

        if (g_debug_keys) {
            fprintf(stderr, "[KEY] flagsChanged code=%u flags=0x%llx optL=%d optR=%d cmdL=%d cmdR=%d\n",
                    (unsigned)code, (unsigned long long)flags, (int)state->optL, (int)state->optR, (int)state->cmdL, (int)state->cmdR);
        }

        // Track Option sides by reading flag state (not toggling)
        // This prevents duplicate events from flipping state incorrectly
        if (code == kVK_RightOption) {
            bool optionPressed = (flags & OPT_MASK) != 0;
            if (optionPressed != state->optR) {
                state->optR = optionPressed;
                puts(state->optR ? "optR-down" : "optR-up");
                fflush(stdout);
            }
        }

        // Track Command sides by reading flag state (not toggling)
        if (code == kVK_RightCommand) {
            bool commandPressed = (flags & kCGEventFlagMaskCommand) != 0;
            if (commandPressed != state->cmdR) {
                state->cmdR = commandPressed;
                puts(state->cmdR ? "cmdR-down" : "cmdR-up");
                fflush(stdout);
            }
        }
    }
    // Ignore keyDown/Up for modifiers; they are not reliable sources for Option state
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

static void cmdC(void) {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);

    const CGKeyCode kVK_COMMAND = 0x37;
    const CGKeyCode kVK_C = 0x08;

    CGEventRef cmdDown = CGEventCreateKeyboardEvent(src, kVK_COMMAND, true);
    CGEventRef cDown   = CGEventCreateKeyboardEvent(src, kVK_C, true);
    CGEventSetFlags(cDown, kCGEventFlagMaskCommand);
    CGEventRef cUp     = CGEventCreateKeyboardEvent(src, kVK_C, false);
    CGEventSetFlags(cUp, kCGEventFlagMaskCommand);
    CGEventRef cmdUp   = CGEventCreateKeyboardEvent(src, kVK_COMMAND, false);

    CGEventPost(kCGHIDEventTap, cmdDown);
    usleep(1000);
    CGEventPost(kCGHIDEventTap, cDown);
    usleep(1000);
    CGEventPost(kCGHIDEventTap, cUp);
    usleep(1000);
    CGEventPost(kCGHIDEventTap, cmdUp);

    CFRelease(cmdDown);
    CFRelease(cDown);
    CFRelease(cUp);
    CFRelease(cmdUp);
    CFRelease(src);
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
    usleep(1000); // 1ms
    CGEventPost(kCGHIDEventTap, vDown);
    usleep(1000); // 1ms
    CGEventPost(kCGHIDEventTap, vUp);
    usleep(1000); // 1ms
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
    // Enable key debug tracing with env var
    const char *dbg = getenv("SF_NATIVE_DEBUG_KEYS");
    if (dbg && (strcmp(dbg, "1") == 0 || strcasecmp(dbg, "true") == 0 || strcasecmp(dbg, "yes") == 0)) {
        g_debug_keys = true;
        fprintf(stderr, "[KEY] Debug key logging enabled\n");
    }
    // Enable text debug logging with env var (PRIVACY: disabled by default)
    const char *dbgText = getenv("SF_NATIVE_DEBUG_TEXT");
    if (dbgText && (strcmp(dbgText, "1") == 0 || strcasecmp(dbgText, "true") == 0 || strcasecmp(dbgText, "yes") == 0)) {
        g_debug_text = true;
        fprintf(stderr, "[TEXT] Debug text logging enabled (PRIVACY WARNING: selected text will be logged)\n");
    }
    if (argc > 1 && strcmp(argv[1], "--mode=paste") == 0) {
        requireAX();
        cmdV();
        return 0;
    }

    // New: explicitly ask for Accessibility permission with OS prompt
    if (argc > 1 && strcmp(argv[1], "--ask-ax") == 0) {
        CFDictionaryRef opts = CFDictionaryCreate(
            kCFAllocatorDefault,
            (const void **)&kAXTrustedCheckOptionPrompt,
            (const void *[]){ kCFBooleanTrue },
            1, &kCFCopyStringDictionaryKeyCallBacks,
               &kCFTypeDictionaryValueCallBacks);

        bool isTrusted = AXIsProcessTrustedWithOptions(opts);
        CFRelease(opts);
        if (isTrusted) {
            puts("ax-granted");
            fflush(stdout);
            return 0;
        } else {
            puts("ax-denied");
            fflush(stdout);
            return 1;
        }
    }
    
    // New: daemon mode for pre-spawned paste helper
    if (argc > 1 && strcmp(argv[1], "--mode=paste-daemon") == 0) {
        requireAX();
        puts("paste-daemon-ready");
        fflush(stdout);
        
        // Wait for paste command via stdin
        char command[1024];
        while (fgets(command, sizeof(command), stdin)) {
            // Trim newline
            command[strcspn(command, "\n")] = 0;
            
            if (strcmp(command, "paste") == 0) {
                cmdV();
                puts("paste-done");
                fflush(stdout);
            } else if (strcmp(command, "exit") == 0) {
                break;
            }
        }
        return 0;
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

    KeyState s = { false, false, false, false, false };
    // Only listen to flagsChanged; modifiers are canonical via flagsChanged + keycode
    CGEventMask m = (1ULL << kCGEventFlagsChanged);
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
