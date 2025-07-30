#include <ApplicationServices/ApplicationServices.h>
#include <IOKit/hid/IOHIDManager.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h> // For usleep

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

// For older SDKs that may not have these defined yet.
#ifndef kCGListenEventAccessGranted
#define kCGListenEventAccessGranted (1)
#endif

#define FN_MASK kCGEventFlagMaskSecondaryFn // 0x00800000

// Modern function to check Input Monitoring permissions using IOHIDManager
bool check_input_monitoring_permission() {
#if defined(__MAC_OS_14_0)   // Sonoma / Sequoia SDKs
    return IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted;
#else
    return CGPreflightListenEventAccess();   // 10.15+
#endif
}

// Function to register the app in Input Monitoring settings
bool register_input_monitoring() {
    // This call will:
    // 1. Register the app in System Settings → Privacy → Input Monitoring (but disabled)
    // 2. Show the permission prompt if not already granted
    // 3. Return true if permission is granted, false otherwise
    IOReturn result = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);
    
    // Add detailed logging to see what's happening
    fprintf(stderr, "[IM] IOHIDRequestAccess returned: 0x%08x\n", result);
    fflush(stderr);
    
    if (result == kIOReturnSuccess) {
        fprintf(stderr, "[IM] Success - permission granted\n");
        fflush(stderr);
    } else if (result == kIOReturnNotPrivileged) {
        fprintf(stderr, "[IM] Not privileged - app not signed or no bundle ID\n");
        fflush(stderr);
    } else {
        fprintf(stderr, "[IM] Other error: 0x%08x\n", result);
        fflush(stderr);
    }
    
    return (result == kIOReturnSuccess);
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
    if (argc > 1 && strcmp(argv[1], "--mode=paste") == 0) {
        requireAX();
        cmdV();
        return 0;
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
                                       kCGEventTapOptionListenOnly, m, cb, &s);

    if (!tap) {
        // Handle case where tap creation fails for other reasons
        return 1;
    }

    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(NULL, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    CFRunLoopRun();
    return 0; // Should not be reached
}