// A separate process from the clipboard helper. No network, image files, or raw
// text output. Only a bounded name list leaves this process over stdin/stdout.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Vision/Vision.h>
#import <NaturalLanguage/NaturalLanguage.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <stdatomic.h>
static atomic_uint captureGeneration;

static id Attribute(AXUIElementRef element, CFStringRef key) {
    if (!element) return nil;
    AXUIElementSetMessagingTimeout(element, 0.015f);
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, key, &value) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}

static BOOL Protected(AXUIElementRef element) {
    return [Attribute(element, kAXSubroleAttribute) isEqual:@"AXSecureTextField"] ||
           [Attribute(element, CFSTR("AXProtectedContent")) isEqual:@YES];
}

static CGRect ElementFrame(AXUIElementRef element) {
    id position = Attribute(element, kAXPositionAttribute);
    id size = Attribute(element, kAXSizeAttribute);
    CGPoint p = CGPointZero;
    CGSize s = CGSizeZero;
    if (position && CFGetTypeID((__bridge CFTypeRef)position) == AXValueGetTypeID())
        AXValueGetValue((__bridge AXValueRef)position, kAXValueCGPointType, &p);
    if (size && CFGetTypeID((__bridge CFTypeRef)size) == AXValueGetTypeID())
        AXValueGetValue((__bridge AXValueRef)size, kAXValueCGSizeType, &s);
    return (CGRect){p, s};
}

static CGRect ContextFrame(AXUIElementRef element) {
    id selected = Attribute(element, kAXSelectedTextRangeAttribute);
    CFRange range;
    if (selected && CFGetTypeID((__bridge CFTypeRef)selected) == AXValueGetTypeID() &&
        AXValueGetValue((__bridge AXValueRef)selected, kAXValueCFRangeType, &range) && range.location >= 0) {
        range.length = 0;
        AXValueRef parameter = AXValueCreate(kAXValueCFRangeType, &range);
        CFTypeRef result = NULL;
        AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute, parameter, &result);
        CFRelease(parameter);
        CGRect caret = CGRectZero;
        BOOL valid = result && CFGetTypeID(result) == AXValueGetTypeID() &&
            AXValueGetValue((AXValueRef)result, kAXValueCGRectType, &caret);
        if (result) CFRelease(result);
        if (valid && caret.size.height > 0) { caret.size.width = MAX(1, caret.size.width); return caret; }
    }
    return ElementFrame(element);
}

static NSArray<NSString *> *ExtractNames(NSString *text, NSMutableDictionary *trace) {
    if (text.length > 4000) text = [text substringToIndex:4000];
    NSMutableArray<NSString *> *names = [NSMutableArray array];
    NSMutableSet *seen = [NSMutableSet set];
    NSMutableArray *tags = trace ? [NSMutableArray array] : nil;
    NSMutableArray *rules = trace ? [NSMutableArray array] : nil;
    void (^add)(NSString *) = ^(NSString *name) {
        name = [name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (name.length < 2 || name.length > 80 || names.count >= 24 || [seen containsObject:name.lowercaseString]) return;
        [seen addObject:name.lowercaseString];
        [names addObject:name];
    };
    NLTagger *tagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeNameType]];
    tagger.string = text;
    [tagger enumerateTagsInRange:NSMakeRange(0, text.length) unit:NLTokenUnitWord
                         scheme:NLTagSchemeNameType
                        options:NLTaggerOmitWhitespace | NLTaggerOmitPunctuation | NLTaggerJoinNames
                     usingBlock:^(NLTag tag, NSRange range, BOOL *stop) {
        BOOL selected = [tag isEqual:NLTagPersonalName] || [tag isEqual:NLTagPlaceName] || [tag isEqual:NLTagOrganizationName];
        if (tags && tags.count < 256) [tags addObject:@{@"text": [text substringWithRange:range], @"tag": tag ?: @"Other", @"selected": @(selected)}];
        if (selected)
            add([text substringWithRange:range]);
        *stop = names.count >= 24;
    }];
    // NLTagger does not reliably know product names and code symbols. Keep
    // distinctive mixed-case identifiers, acronyms, and letter/digit product names.
    // NLTagger labels DFlash2 as OtherWord. Require a capital letter so units
    // such as 32px and ordinary lowercase tokens do not become product hints.
    NSRegularExpression *tokens = [NSRegularExpression regularExpressionWithPattern:@"\\b(?:[\\p{Lu}]{2,12}|[\\p{L}]*\\p{Ll}\\p{Lu}[\\p{L}\\p{N}]*|[\\p{Lu}]{2,}[\\p{Ll}][\\p{L}]*|(?=[\\p{L}\\p{N}]*\\p{Lu})(?=[\\p{L}\\p{N}]*\\p{N})\\p{L}[\\p{L}\\p{N}]*)\\b" options:0 error:nil];
    for (NSTextCheckingResult *match in [tokens matchesInString:text options:0 range:NSMakeRange(0, text.length)]) {
        add([text substringWithRange:match.range]);
        if (rules.count < 128) [rules addObject:[text substringWithRange:match.range]];
    }
    if (trace) { trace[@"text"] = text; trace[@"appleTags"] = tags; trace[@"identifierRuleMatches"] = rules; trace[@"selectedTerms"] = names; trace[@"maxTerms"] = @24; }
    return names;
}

NSArray<NSString *> *SpokeContextNames(NSString *text) { return ExtractNames(text, nil); }

static NSString *BoundedText(AXUIElementRef element) {
    NSNumber *count = Attribute(element, kAXNumberOfCharactersAttribute);
    if ([count isKindOfClass:NSNumber.class] && count.integerValue > 4000) {
        id selected = Attribute(element, kAXSelectedTextRangeAttribute);
        CFRange range;
        if (selected && CFGetTypeID((__bridge CFTypeRef)selected) == AXValueGetTypeID() &&
            AXValueGetValue((__bridge AXValueRef)selected, kAXValueCFRangeType, &range) && range.location >= 0) {
            range.location = MAX(0, range.location - 1000);
            range.length = MIN(2000, count.longLongValue - range.location);
            if (range.length <= 0) return @"";
            AXValueRef value = AXValueCreate(kAXValueCFRangeType, &range);
            CFTypeRef result = NULL;
            AXUIElementCopyParameterizedAttributeValue(element, kAXStringForRangeParameterizedAttribute, value, &result);
            CFRelease(value);
            id string = CFBridgingRelease(result);
            return [string isKindOfClass:NSString.class] ? string : @"";
        }
        return @"";
    }
    // Value is read only with a bounded character count. Static text normally
    // exposes its text as Value without a count; those leaves are bounded below.
    NSString *role = Attribute(element, kAXRoleAttribute);
    if (![count isKindOfClass:NSNumber.class] && ![role isEqual:@"AXStaticText"]) return @"";
    id value = Attribute(element, kAXValueAttribute);
    if (![value isKindOfClass:NSString.class]) return @"";
    return [value length] <= 4000 ? value : [value substringToIndex:4000];
}

static NSString *AXContext(AXUIElementRef focus, AXUIElementRef window) {
    NSMutableString *text = [NSMutableString string];
    NSMutableArray *queue = [NSMutableArray array];
    if (focus) [queue addObject:(__bridge id)focus];
    if (window && (!focus || !CFEqual(focus, window))) [queue addObject:(__bridge id)window];
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.12;
    for (NSUInteger index = 0; index < queue.count && index < 48 && text.length < 4000; index++) {
        if (CFAbsoluteTimeGetCurrent() > deadline) break;
        AXUIElementRef element = (__bridge AXUIElementRef)queue[index];
        if (Protected(element)) continue;
        NSString *part = BoundedText(element);
        if (part.length) {
            [text appendString:[part substringToIndex:MIN(part.length, 4000 - text.length)]];
            if (text.length < 4000) [text appendString:@"\n"];
        }
        if (queue.count < 48) {
            id children = Attribute(element, kAXChildrenAttribute);
            if ([children isKindOfClass:NSArray.class])
                [queue addObjectsFromArray:[children subarrayWithRange:NSMakeRange(0, MIN([children count], 48 - queue.count))]];
        }
    }
    return text;
}

static NSArray *Recognize(CGImageRef image, NSMutableDictionary *trace) {
    VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
    // Predictable startup: fast avoids accurate-mode's observed ANE compilation
    // stall. Crop at >=1 pixel/point rather than shrinking an entire display.
    request.recognitionLevel = VNRequestTextRecognitionLevelFast;
    request.usesLanguageCorrection = NO;
    request.preferBackgroundProcessing = YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    if (![handler performRequests:@[request] error:nil]) return @[];
    NSMutableString *text = [NSMutableString string];
    NSMutableArray *lines = trace ? [NSMutableArray array] : nil;
    for (VNRecognizedTextObservation *observation in request.results) {
        VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
        if (candidate && lines.count < 128) [lines addObject:@{@"text": candidate.string, @"confidence": @(candidate.confidence), @"accepted": @(candidate.confidence >= 0.5), @"bounds": @[@(observation.boundingBox.origin.x), @(observation.boundingBox.origin.y), @(observation.boundingBox.size.width), @(observation.boundingBox.size.height)]}];
        if (candidate.confidence < 0.5 || !candidate.string) continue;
        if (text.length + candidate.string.length > 4000) break;
        [text appendFormat:@"%@\n", candidate.string];
    }
    if (trace) { trace[@"ocrLines"] = lines; trace[@"ocrMode"] = @"fast"; trace[@"confidenceThreshold"] = @0.5; trace[@"boundsOrigin"] = @"bottom-left-normalized"; }
    return ExtractNames(text, trace);
}

// A separate debug event follows the normal result. PNG encoding cannot delay
// delivery of the vocabulary used by dictation. Only explicit test runs do this.
static void DebugReply(NSString *identifier, NSMutableDictionary *trace, CGImageRef image) {
    if (!trace) return;
    trace[@"id"] = identifier; trace[@"event"] = @"debug";
    if (image) {
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (png.length <= 2800000) trace[@"png"] = [png base64EncodedStringWithOptions:0];
        else trace[@"imageStatus"] = @"too-large";
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:trace options:0 error:nil];
    if (json) { printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String); fflush(stdout); }
}

static void Reply(NSString *identifier, NSArray *terms, NSString *source, NSString *status, CFAbsoluteTime start) {
    NSDictionary *result = @{ @"id": identifier, @"terms": terms, @"source": source,
                              @"status": status, @"ms": @((CFAbsoluteTimeGetCurrent() - start) * 1000) };
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    fflush(stdout);
}

static CGWindowID TopWindow(pid_t pid) {
    NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    for (NSDictionary *entry in windows) {
        if ([entry[(id)kCGWindowOwnerPID] intValue] != pid || [entry[(id)kCGWindowLayer] intValue] != 0) continue;
        CGRect frame;
        if (CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)entry[(id)kCGWindowBounds], &frame) && frame.size.width > 100 && frame.size.height > 80)
            return [entry[(id)kCGWindowNumber] unsignedIntValue];
    }
    return 0;
}

static BOOL SameTarget(pid_t pid, id focused, id window, CGWindowID windowID) {
    __block pid_t current;
    dispatch_sync(dispatch_get_main_queue(), ^{ current = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier; });
    if (current != pid) return NO;
    if (windowID && TopWindow(pid) != windowID) return NO;
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    id nextFocus = Attribute(app, kAXFocusedUIElementAttribute);
    id nextWindow = Attribute(app, kAXFocusedWindowAttribute);
    CFRelease(app);
    return (!focused || [focused isEqual:nextFocus]) && (!window || [window isEqual:nextWindow]) &&
           (!nextFocus || !Protected((__bridge AXUIElementRef)nextFocus));
}

static void WatchTarget(NSString *identifier, pid_t pid, id focused, id window, CGWindowID windowID, unsigned int generation, dispatch_queue_t queue, CFAbsoluteTime start) {
    if (atomic_load(&captureGeneration) != generation || CFAbsoluteTimeGetCurrent() - start > 300) return;
    if (!SameTarget(pid, focused, window, windowID)) {
        Reply(identifier, @[], @"none", @"target-changed", start);
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), queue, ^{
        @autoreleasepool { WatchTarget(identifier, pid, focused, window, windowID, generation, queue, start); }
    });
}

static void Capture(NSString *identifier, pid_t pid, unsigned int generation, BOOL debug, dispatch_queue_t queue) {
    CFAbsoluteTime start = CFAbsoluteTimeGetCurrent();
    if (atomic_load(&captureGeneration) != generation) return;
    if (pid <= 0 || pid == getppid() || pid == getpid()) { Reply(identifier, @[], @"none", @"own-app", start); return; }
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    id focused = Attribute(app, kAXFocusedUIElementAttribute);
    id window = Attribute(app, kAXFocusedWindowAttribute);
    CFRelease(app);
    AXUIElementRef focus = (__bridge AXUIElementRef)focused;
    if (focus && Protected(focus)) { Reply(identifier, @[], @"none", @"protected", start); return; }
    NSMutableDictionary *trace = debug ? [NSMutableDictionary dictionaryWithDictionary:@{@"pid": @(pid), @"app": [NSRunningApplication runningApplicationWithProcessIdentifier:pid].localizedName ?: @"unknown"}] : nil;
    NSMutableDictionary *axTrace = debug ? [NSMutableDictionary dictionary] : nil;
    NSArray *names = ExtractNames(AXContext(focus, (__bridge AXUIElementRef)window), axTrace);
    if (trace) trace[@"accessibility"] = axTrace;
    if (!SameTarget(pid, focused, window, 0)) { Reply(identifier, @[], @"none", @"target-changed", start); return; }
    if (names.count) {
        Reply(identifier, names, @"accessibility", @"ready", start);
        trace[@"source"] = @"accessibility";
        DebugReply(identifier, trace, NULL);
        WatchTarget(identifier, pid, focused, window, 0, generation, queue, start);
        return;
    }
    if (!CGPreflightScreenCaptureAccess()) { Reply(identifier, @[], @"none", @"screen-permission", start); DebugReply(identifier, trace, NULL); return; }
    CGRect focusFrame = focus ? ContextFrame(focus) : CGRectZero;

    // Pin the frontmost on-screen window of this process. Never fall back to
    // another app or the whole display when a window cannot be identified.
    CGWindowID target = TopWindow(pid);
    if (!target) { Reply(identifier, @[], @"none", @"no-window", start); DebugReply(identifier, trace, NULL); return; }
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        SCWindow *selected = nil;
        for (SCWindow *candidate in content.windows) if (candidate.windowID == target) { selected = candidate; break; }
        if (!selected || error) { Reply(identifier, @[], @"none", @"capture-unavailable", start); DebugReply(identifier, trace, NULL); return; }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
        CGRect frame = selected.frame;
        CGSize size = CGSizeMake(MIN(960, frame.size.width), MIN(360, frame.size.height));
        CGPoint center = CGRectIsEmpty(focusFrame) ? CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame)) :
            CGPointMake(CGRectGetMidX(focusFrame), CGRectGetMinY(focusFrame));
        // Independent-window source coordinates are relative to the window.
        CGRect crop = CGRectMake(MAX(0, MIN(frame.size.width - size.width, center.x - frame.origin.x - size.width / 2)),
                                 MAX(0, MIN(frame.size.height - size.height, center.y - frame.origin.y - size.height / 2)), size.width, size.height);
        CGFloat scale = MAX(1, MIN(1.5, filter.pointPixelScale));
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.sourceRect = crop;
        config.width = (size_t)ceil(size.width * scale);
        config.height = (size_t)ceil(size.height * scale);
        config.showsCursor = NO;
        config.ignoreShadowsSingleWindow = YES;
        if (trace) {
            trace[@"source"] = @"ocr";
            trace[@"windowFrame"] = @[@(frame.origin.x), @(frame.origin.y), @(frame.size.width), @(frame.size.height)];
            trace[@"cropInWindowPoints"] = @[@(crop.origin.x), @(crop.origin.y), @(crop.size.width), @(crop.size.height)];
            trace[@"pixels"] = @[@(config.width), @(config.height)];
        }
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
            if (!image || captureError) { Reply(identifier, @[], @"none", @"capture-failed", start); DebugReply(identifier, trace, NULL); return; }
            CGImageRetain(image);
            dispatch_async(queue, ^{
                @autoreleasepool {
                    NSMutableDictionary *ocrTrace = debug ? [NSMutableDictionary dictionary] : nil;
                    NSArray *terms = Recognize(image, ocrTrace);
                    if (trace) trace[@"ocr"] = ocrTrace;
                    BOOL valid = SameTarget(pid, focused, window, target);
                    Reply(identifier, valid ? terms : @[], @"ocr", valid ? @"ready" : @"target-changed", start);
                    DebugReply(identifier, trace, image);
                    CGImageRelease(image);
                    if (valid) WatchTarget(identifier, pid, focused, window, target, generation, queue, start);
                }
            });
        }];
    }];
}

int SpokeContextDaemon(void) {
    dispatch_queue_t queue = dispatch_queue_create("com.spoke.local-context", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0));
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        char *line = NULL; size_t capacity = 0; ssize_t length;
        while ((length = getline(&line, &capacity, stdin)) > 0) {
            @autoreleasepool {
                if (length > 1024) break;
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:line length:length] options:0 error:nil];
                if (![request isKindOfClass:NSDictionary.class]) continue;
                if ([request[@"command"] isEqual:@"warm"]) {
                    dispatch_async(queue, ^{
                        @autoreleasepool {
                            CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
                            CGContextRef context = CGBitmapContextCreate(NULL, 64, 32, 8, 256, color, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
                            if (context) {
                                CGImageRef image = CGBitmapContextCreateImage(context);
                                if (image) { Recognize(image, nil); CGImageRelease(image); }
                                CGContextRelease(context);
                            }
                            CGColorSpaceRelease(color);
                        }
                    });
                } else if ([request[@"command"] isEqual:@"cancel"]) {
                    atomic_fetch_add(&captureGeneration, 1);
                } else if ([request[@"command"] isEqual:@"capture"] && [request[@"id"] isKindOfClass:NSString.class]) {
                    unsigned int generation = atomic_fetch_add(&captureGeneration, 1) + 1;
                    NSString *identifier = request[@"id"];
                    BOOL debug = [request[@"debug"] isEqual:@YES];
                    dispatch_async(dispatch_get_main_queue(), ^{
                        pid_t pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
                        dispatch_async(queue, ^{ @autoreleasepool { Capture(identifier, pid, generation, debug, queue); } });
                    });
                }
            }
        }
        free(line); exit(0);
    });
    CFRunLoopRun();
    return 0;
}

// Reproducible local performance probe. Uses a synthetic image only; it does
// not request permissions or capture a screen. Includes OCR and name tagging.
int SpokeContextBenchmark(BOOL debug) {
    @autoreleasepool {
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1440 pixelsHigh:540 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
        [[NSColor whiteColor] setFill]; NSRectFill(NSMakeRect(0, 0, 1440, 540));
        NSString *fixture = debug ? @"Use DFlash2 for this project.\nReview TypeScript and OpenAI." : @"Meeting with Priyanka Sharma in Bengaluru.\nReview OpenAI and TypeScript with Microsoft.\nThe project uses GraphQL and PostgreSQL.\nSend the proposal to Acme Labs.";
        [fixture drawInRect:NSMakeRect(36, 36, 1368, 468) withAttributes:@{NSFontAttributeName: [NSFont systemFontOfSize:21], NSForegroundColorAttributeName: NSColor.blackColor}];
        [NSGraphicsContext restoreGraphicsState];
        if (debug) {
            NSMutableDictionary *ocr = [NSMutableDictionary dictionary];
            Recognize(bitmap.CGImage, ocr);
            NSMutableDictionary *trace = [NSMutableDictionary dictionaryWithDictionary:@{@"synthetic": @YES, @"app": @"Synthetic DFlash2 fixture", @"source": @"ocr", @"ocr": ocr, @"windowFrame": @[@0, @0, @960, @360], @"cropInWindowPoints": @[@0, @0, @960, @360], @"pixels": @[@1440, @540]}];
            DebugReply(@"synthetic-dflash2", trace, bitmap.CGImage);
            return 0;
        }
        NSMutableArray *times = [NSMutableArray array];
        NSArray *terms = @[];
        for (int i = 0; i < 11; i++) {
            CFAbsoluteTime start = CFAbsoluteTimeGetCurrent();
            terms = Recognize(bitmap.CGImage, nil);
            [times addObject:@((CFAbsoluteTimeGetCurrent() - start) * 1000)];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"fixturePixels": @[@1440, @540], @"ocrAndNamesMs": times, @"names": terms} options:0 error:nil];
        puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
        return terms.count ? 0 : 1;
    }
}

int SpokeContextAnalyzeText(void) {
    @autoreleasepool {
        // Offline replay only. Never interprets input as commands or file paths.
        char bytes[20001]; size_t length = fread(bytes, 1, 20000, stdin);
        NSString *text = [[NSString alloc] initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];
        if (!text) return 1;
        NSMutableDictionary *trace = [NSMutableDictionary dictionary];
        ExtractNames(text, trace);
        DebugReply(@"analysis", trace, NULL);
        return 0;
    }
}
