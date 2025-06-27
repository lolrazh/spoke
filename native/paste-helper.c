#include <ApplicationServices/ApplicationServices.h>

void sendPaste() {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);

    CGEventRef down = CGEventCreateKeyboardEvent(src, /*V*/ 9, true);
    CGEventRef up   = CGEventCreateKeyboardEvent(src, /*V*/ 9, false);
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up,   kCGEventFlagMaskCommand);

    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);

    CFRelease(down); CFRelease(up); CFRelease(src);
}

int main() { sendPaste(); return 0; } 