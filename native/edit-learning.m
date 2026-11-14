// Read-back verification runs after paste ACK on a separate utility queue.
// No clipboard probing, OCR, key content recording, or network access.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdatomic.h>

extern NSArray<NSString *> *SpokeContextNames(NSString *text);
static atomic_uint generation;

void SpokeStopLearning(void) { atomic_fetch_add(&generation, 1); }

static id Read(AXUIElementRef element, CFStringRef name) {
    AXUIElementSetMessagingTimeout(element, 0.02f);
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}

@interface SpokeEditWatch : NSObject
@property(nonatomic, strong) id field;
@property pid_t pid;
@property unsigned int generation;
@property(nonatomic, copy) NSString *prefix;
@property(nonatomic, copy) NSString *suffix;
@property(nonatomic, copy) NSString *inserted;
@property(nonatomic, copy) NSString *last;
@property(nonatomic, copy) NSString *identifier;
@property CFAbsoluteTime start;
@property CFAbsoluteTime changed;
@property BOOL verified;
@property uint32_t keys;
@end

@implementation SpokeEditWatch
- (NSInteger)observe:(NSString *)value keys:(uint32_t)keys now:(CFAbsoluteTime)now {
    if (!self.verified) {
        NSString *expected = [NSString stringWithFormat:@"%@%@%@", self.prefix, self.inserted, self.suffix];
        if ([value isEqual:expected]) { self.verified = YES; self.keys = keys; self.last = self.inserted; }
        else if (now - self.start > 1.5) return 0;
    } else {
        // Exact surrounding text pins the inserted region. An edit elsewhere
        // invalidates this watch rather than learning from an unrelated field.
        if (![value hasPrefix:self.prefix] || ![value hasSuffix:self.suffix] ||
            value.length < self.prefix.length + self.suffix.length) return 0;
        NSString *edited = [value substringWithRange:NSMakeRange(self.prefix.length, value.length - self.prefix.length - self.suffix.length)];
        if (![edited isEqual:self.last]) {
            if (keys == self.keys || !edited.length || edited.length > 4096) return 0;
            self.last = edited; self.changed = now; self.keys = keys;
        } else if (self.changed && now - self.changed >= 1.5 && ![edited isEqual:self.inserted]) return 2;
    }
    return 1;
}

- (void)tick {
    if (atomic_load(&generation) != self.generation || CFAbsoluteTimeGetCurrent() - self.start > 30) return;
    AXUIElementRef system = AXUIElementCreateSystemWide();
    id app = Read(system, kAXFocusedApplicationAttribute);
    CFRelease(system);
    if (!app) return;
    pid_t pid = 0;
    AXUIElementGetPid((__bridge AXUIElementRef)app, &pid);
    if (pid != self.pid) return;
    id focused = Read((__bridge AXUIElementRef)app, kAXFocusedUIElementAttribute);
    if (![self.field isEqual:focused]) return;
    AXUIElementRef field = (__bridge AXUIElementRef)self.field;
    if ([Read(field, kAXSubroleAttribute) isEqual:@"AXSecureTextField"] ||
        [Read(field, CFSTR("AXProtectedContent")) isEqual:@YES]) return;
    id count = Read(field, kAXNumberOfCharactersAttribute);
    if (![count isKindOfClass:NSNumber.class] || [count integerValue] < 0 || [count integerValue] > 8192) return;
    id value = Read(field, kAXValueAttribute);
    if (![value isKindOfClass:NSString.class] || [value length] > 8192) return;
    CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
    uint32_t keys = CGEventSourceCounterForEventType(kCGEventSourceStateHIDSystemState, kCGEventKeyDown);
    NSInteger observation = [self observe:value keys:keys now:now];
    if (observation == 0) return;
    if (observation == 2) {
            NSArray *names = SpokeContextNames(self.last);
            if (atomic_load(&generation) != self.generation) return;
            NSDictionary *event = @{ @"id": self.identifier, @"before": self.inserted, @"after": self.last, @"names": names, @"verified": @YES, @"startedAt": @((self.start + kCFAbsoluteTimeIntervalSince1970) * 1000) };
            NSData *json = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
            printf("learning:%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
            fflush(stdout);
            return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ @autoreleasepool { [self tick]; } });
}
@end

void SpokeWatchEdit(AXUIElementRef field, pid_t pid, NSString *baseline, CFRange range, NSString *inserted) {
    SpokeStopLearning();
    if (!field || !baseline || !inserted.length || inserted.length > 4096 ||
        baseline.length > 4096 || range.location < 0 || range.length < 0 ||
        range.location > baseline.length || range.length > baseline.length - range.location) return;
    SpokeEditWatch *watch = [SpokeEditWatch new];
    watch.field = (__bridge id)field;
    watch.pid = pid;
    watch.generation = atomic_load(&generation);
    watch.prefix = [baseline substringToIndex:range.location];
    watch.suffix = [baseline substringFromIndex:range.location + range.length];
    watch.inserted = inserted;
    watch.identifier = NSUUID.UUID.UUIDString;
    watch.start = CFAbsoluteTimeGetCurrent();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ @autoreleasepool { [watch tick]; } });
}
