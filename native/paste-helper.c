#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>  // For logging
#include <unistd.h> // For usleep

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

int main() {
    requireAX();
    cmdV();
    return 0;
} 