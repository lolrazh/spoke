#include <ApplicationServices/ApplicationServices.h>

// Asks for Accessibility permissions on first run.
// Exits if permission is not granted, so the paste doesn't silently fail.
static void requireAX(void) {
    CFDictionaryRef opts = CFDictionaryCreate(
        kCFAllocatorDefault,
        (const void **)&kAXTrustedCheckOptionPrompt,
        (const void *[]){ kCFBooleanTrue },
        1, &kCFCopyStringDictionaryKeyCallBacks,
           &kCFTypeDictionaryValueCallBacks);

    if (!AXIsProcessTrustedWithOptions(opts)) {
        exit(1); // Bail, so Electron sees a non-zero exit code.
    }
    CFRelease(opts);
}

// Sends a robust, correct 4-event sequence for Command-V.
static void cmdV(void) {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);

    // Key Codes
    const CGKeyCode kVK_COMMAND = 0x37;
    const CGKeyCode kVK_V = 0x09;

    // 1. Command Down
    CGEventRef cmdDown = CGEventCreateKeyboardEvent(src, kVK_COMMAND, true);

    // 2. V Down (with Command flag)
    CGEventRef vDown   = CGEventCreateKeyboardEvent(src, kVK_V, true);
    CGEventSetFlags(vDown, kCGEventFlagMaskCommand);

    // 3. V Up (with Command flag)
    CGEventRef vUp     = CGEventCreateKeyboardEvent(src, kVK_V, false);
    CGEventSetFlags(vUp, kCGEventFlagMaskCommand);

    // 4. Command Up
    CGEventRef cmdUp   = CGEventCreateKeyboardEvent(src, kVK_COMMAND, false);

    // Post all four events
    CGEventPost(kCGHIDEventTap, cmdDown);
    CGEventPost(kCGHIDEventTap, vDown);
    CGEventPost(kCGHIDEventTap, vUp);
    CGEventPost(kCGHIDEventTap, cmdUp);

    // Clean up
    CFRelease(cmdDown);
    CFRelease(vDown);
    CFRelease(vUp);
    CFRelease(cmdUp);
    CFRelease(src);
}

int main() {
    requireAX();
    cmdV();
    return 0;
} 