#include <ApplicationServices/ApplicationServices.h>
#define FN_MASK kCGEventFlagMaskSecondaryFn  // 0x00800000
CGEventRef cb(CGEventTapProxy, CGEventType t, CGEventRef e, void *ctx){
    if(t==kCGEventFlagsChanged){
        bool *prev=(bool*)ctx; bool now=CGEventGetFlags(e)&FN_MASK;
        if(now && !*prev) puts("down");
        if(!now && *prev) puts("up");
        *prev=now;
    }
    return e;
}
int main(){ bool s=false; CGEventMask m=1ULL<<kCGEventFlagsChanged;
    CFMachPortRef tap=CGEventTapCreate(kCGSessionEventTap,kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly,m,cb,&s);
    CFRunLoopSourceRef src=CFMachPortCreateRunLoopSource(NULL,tap,0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(),src,kCFRunLoopCommonModes);
    CGEventTapEnable(tap,true); CFRunLoopRun(); } 