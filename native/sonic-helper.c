#include <ApplicationServices/ApplicationServices.h>
#include <IOKit/hid/IOHIDManager.h>
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h> // For usleep
#include <signal.h>
#include <dispatch/dispatch.h>

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
