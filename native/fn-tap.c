#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>

// For older SDKs that may not have these defined yet.
#ifndef kCGListenEventAccessGranted
#define kCGListenEventAccessGranted (1)
#endif

#define FN_MASK kCGEventFlagMaskSecondaryFn  // 0x00800000

// Pre-flight check for permissions
bool check_permissions() {
    if (CGPreflightListenEventAccess() != kCGListenEventAccessGranted) {
        // Request permissions and check again. This will show the prompt.
        if (CGRequestListenEventAccess() != kCGListenEventAccessGranted) {
             puts("perm-denied");
             fflush(stdout); // Ensure the message is sent immediately
             return false;
        }
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

int main() {
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