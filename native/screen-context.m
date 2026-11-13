// A separate process from the clipboard helper. Normal mode emits only bounded
// terms. Explicit debug mode can emit local text and images. No network access.
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

static NSArray<NSString *> *ExtractNames(NSString *text, NSMutableDictionary *trace) {
    if (text.length > 4000) text = [text substringToIndex:4000];
    NSMutableArray<NSString *> *names = [NSMutableArray array];
    NSMutableArray<NSString *> *tagged = [NSMutableArray array];
    NSMutableArray<NSString *> *identifiers = [NSMutableArray array];
    NSMutableArray<NSString *> *acronyms = [NSMutableArray array];
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
        if (selected && tagged.count < 128) [tagged addObject:[text substringWithRange:range]];
    }];
    // NLTagger does not reliably know product names and code symbols. Keep
    // distinctive mixed-case identifiers, acronyms, and letter/digit product names.
    // NLTagger labels DFlash2 as OtherWord. Require a capital letter so units
    // such as 32px and ordinary lowercase tokens do not become product hints.
    NSRegularExpression *tokens = [NSRegularExpression regularExpressionWithPattern:@"\\b(?:[\\p{Lu}]{2,12}|[\\p{L}]*\\p{Ll}\\p{Lu}[\\p{L}]*[0-9]*|[\\p{Lu}]{2,}[\\p{Ll}][\\p{L}]*|\\p{Lu}[\\p{L}]*[0-9]+|[A-Z]{2,}[0-9]+[a-z]+|[A-Z][A-Z0-9]*[0-9][A-Z0-9]*)\\b" options:0 error:nil];
    for (NSTextCheckingResult *match in [tokens matchesInString:text options:0 range:NSMakeRange(0, text.length)]) {
        NSString *term = [text substringWithRange:match.range];
        if ([@[@"KB", @"MB", @"GB", @"TB", @"PX"] containsObject:term]) continue;
        BOOL acronym = [term isEqual:term.uppercaseString] && [term rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet].location == NSNotFound;
        [(acronym ? acronyms : identifiers) addObject:term];
        if (rules.count < 128) [rules addObject:term];
    }
    // Read the entire bounded text before applying the limit. Distinctive
    // identifiers near the bottom must not lose to 24 earlier generic names.
    for (NSString *term in identifiers) add(term);
    for (NSString *term in tagged) add(term);
    for (NSString *term in acronyms) add(term);
    if (trace) { trace[@"text"] = text; trace[@"appleTags"] = tags; trace[@"identifierRuleMatches"] = rules; trace[@"selectedTerms"] = names; trace[@"maxTerms"] = @24; }
    return names;
}

NSArray<NSString *> *SpokeContextNames(NSString *text) { return ExtractNames(text, nil); }

// A name count is not evidence that Accessibility exposed the page. Only a
// fully readable large text area can satisfy coverage without an image.
static BOOL CoversWindow(CGRect textFrame, CGRect windowFrame, BOOL complete) {
    if (!complete || CGRectIsEmpty(windowFrame)) return NO;
    CGRect overlap = CGRectIntersection(textFrame, windowFrame);
    return !CGRectIsNull(overlap) && overlap.size.width * overlap.size.height >=
        windowFrame.size.width * windowFrame.size.height * 0.8;
}

static NSString *BoundedText(AXUIElementRef element, BOOL *complete) {
    *complete = NO;
    id count = Attribute(element, kAXNumberOfCharactersAttribute);
    NSString *role = Attribute(element, kAXRoleAttribute);
    id visible = Attribute(element, kAXVisibleCharacterRangeAttribute);
    CFRange range;
    if (visible && CFGetTypeID((__bridge CFTypeRef)visible) == AXValueGetTypeID() &&
        AXValueGetValue((__bridge AXValueRef)visible, kAXValueCFRangeType, &range) &&
        range.location >= 0 && range.length >= 0) {
        BOOL bounded = range.length <= 4000;
        range.length = MIN(range.length, 4000);
        AXValueRef parameter = AXValueCreate(kAXValueCFRangeType, &range);
        CFTypeRef result = NULL;
        AXUIElementCopyParameterizedAttributeValue(element, kAXStringForRangeParameterizedAttribute, parameter, &result);
        CFRelease(parameter);
        id value = CFBridgingRelease(result);
        if ([value isKindOfClass:NSString.class] && [value length] <= 4000) {
            *complete = bounded && [value length] == range.length;
            return value;
        }
    }
    if ([count isKindOfClass:NSNumber.class] && ([count longLongValue] < 0 || [count longLongValue] > 4000)) return @"";
    if (![count isKindOfClass:NSNumber.class] && ![role isEqual:@"AXStaticText"]) return @"";
    id value = Attribute(element, kAXValueAttribute);
    if (![value isKindOfClass:NSString.class]) return @"";
    *complete = [count isKindOfClass:NSNumber.class] && [value length] == [count unsignedIntegerValue] && [value length] <= 4000;
    return [value substringToIndex:MIN([value length], 4000)];
}

static NSString *AXContext(AXUIElementRef focus, AXUIElementRef window, BOOL *coversContent, NSMutableDictionary *trace) {
    NSMutableString *text = [NSMutableString string];
    NSMutableArray *queue = [NSMutableArray array];
    NSMutableSet *seen = [NSMutableSet set];
    CGRect windowFrame = ElementFrame(window);
    if (focus) [queue addObject:(__bridge id)focus];
    if (window) [queue addObject:(__bridge id)window];
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.12;
    *coversContent = NO;
    NSUInteger visited = 0;
    for (NSUInteger index = 0; index < queue.count && text.length < 4000; index++) {
        if (CFAbsoluteTimeGetCurrent() > deadline || visited >= 192) break;
        id object = queue[index];
        if ([seen containsObject:object]) continue;
        [seen addObject:object]; visited++;
        AXUIElementRef element = (__bridge AXUIElementRef)object;
        if (Protected(element)) continue;
        CGRect frame = ElementFrame(element);
        if (!CGRectIsEmpty(frame) && !CGRectIsEmpty(windowFrame) && !CGRectIntersectsRect(frame, windowFrame)) continue;
        BOOL complete = NO;
        NSString *part = BoundedText(element, &complete);
        if (part.length) {
            if ([Attribute(element, kAXRoleAttribute) isEqual:@"AXTextArea"] &&
                CoversWindow(frame, windowFrame, complete) && text.length + part.length <= 4000) *coversContent = YES;
            [text appendString:[part substringToIndex:MIN(part.length, 4000 - text.length)]];
            if (text.length < 4000) [text appendString:@"\n"];
        }
        if (queue.count < 256) {
            id children = Attribute(element, kAXVisibleChildrenAttribute);
            if (![children isKindOfClass:NSArray.class]) children = Attribute(element, kAXChildrenAttribute);
            if ([children isKindOfClass:NSArray.class])
                [queue addObjectsFromArray:[children subarrayWithRange:NSMakeRange(0, MIN([children count], 256 - queue.count))]];
        }
    }
    if (trace) { trace[@"visitedNodes"] = @(visited); trace[@"coversContent"] = @(*coversContent); }
    return text;
}

// Keep all visible window content when it fits the pixel budget. Never shrink
// a whole window to the old 960x360 crop. Oversized windows are explicitly capped.
static CGRect WindowCrop(CGRect window, CGRect displays, CGFloat scale) {
    CGRect visible = CGRectIntersection(window, displays);
    if (CGRectIsNull(visible) || CGRectIsEmpty(visible)) return CGRectZero;
    double ratio = MIN(1, sqrt(8000000.0 / (visible.size.width * visible.size.height * scale * scale)));
    CGSize size = CGSizeMake(floor(visible.size.width * ratio), floor(visible.size.height * ratio));
    return CGRectMake(CGRectGetMidX(visible) - window.origin.x - size.width / 2,
                      CGRectGetMidY(visible) - window.origin.y - size.height / 2, size.width, size.height);
}

static NSArray *MergeNames(NSArray *first, NSArray *second) {
    NSMutableArray *result = [NSMutableArray array];
    NSMutableSet *seen = [NSMutableSet set];
    for (NSString *name in [first arrayByAddingObjectsFromArray:second]) {
        if (![seen containsObject:name.lowercaseString] && result.count < 24) {
            [seen addObject:name.lowercaseString]; [result addObject:name];
        }
    }
    return result;
}

static NSArray *Recognize(CGImageRef image, NSMutableDictionary *trace) {
    VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
    // Predictable startup: fast avoids accurate-mode's observed ANE compilation
    // stall. Keep readable window pixels instead of shrinking a whole display.
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

static BOOL SameTarget(pid_t pid, id window, CGWindowID windowID) {
    __block pid_t current;
    dispatch_sync(dispatch_get_main_queue(), ^{ current = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier; });
    if (current != pid) return NO;
    if (windowID && TopWindow(pid) != windowID) return NO;
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    id nextFocus = Attribute(app, kAXFocusedUIElementAttribute);
    id nextWindow = Attribute(app, kAXFocusedWindowAttribute);
    CFRelease(app);
    return (!window || [window isEqual:nextWindow]) &&
           (!nextFocus || !Protected((__bridge AXUIElementRef)nextFocus));
}

static void WatchTarget(NSString *identifier, pid_t pid, id window, CGWindowID windowID, unsigned int generation, dispatch_queue_t queue, CFAbsoluteTime start) {
    if (atomic_load(&captureGeneration) != generation || CFAbsoluteTimeGetCurrent() - start > 300) return;
    if (!SameTarget(pid, window, windowID)) {
        Reply(identifier, @[], @"none", @"target-changed", start);
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), queue, ^{
        @autoreleasepool { WatchTarget(identifier, pid, window, windowID, generation, queue, start); }
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
    BOOL coversContent = NO;
    NSString *axText = AXContext(focus, (__bridge AXUIElementRef)window, &coversContent, axTrace);
    NSArray *names = ExtractNames(axText, axTrace);
    CGWindowID target = TopWindow(pid);
    if (trace) trace[@"accessibility"] = axTrace;
    if (!SameTarget(pid, window, target)) { Reply(identifier, @[], @"none", @"target-changed", start); return; }
    if (coversContent) {
        Reply(identifier, names, @"accessibility", @"ready", start);
        trace[@"source"] = @"accessibility";
        DebugReply(identifier, trace, NULL);
        WatchTarget(identifier, pid, window, target, generation, queue, start);
        return;
    }
    if (!CGPreflightScreenCaptureAccess()) { Reply(identifier, names, @"accessibility", @"screen-permission", start); DebugReply(identifier, trace, NULL); WatchTarget(identifier, pid, window, target, generation, queue, start); return; }

    // Pin the frontmost on-screen window of this process. Never fall back to
    // another app or the whole display when a window cannot be identified.
    if (!target) { Reply(identifier, names, @"accessibility", @"no-window", start); DebugReply(identifier, trace, NULL); WatchTarget(identifier, pid, window, target, generation, queue, start); return; }
    if (names.count) Reply(identifier, names, @"accessibility", @"partial", start);
    WatchTarget(identifier, pid, window, target, generation, queue, start);
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        SCWindow *selected = nil;
        for (SCWindow *candidate in content.windows) if (candidate.windowID == target) { selected = candidate; break; }
        if (atomic_load(&captureGeneration) != generation) return;
        if (!selected || error) { Reply(identifier, names, @"accessibility", @"capture-unavailable", start); DebugReply(identifier, trace, NULL); return; }
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
        CGRect frame = selected.frame;
        CGFloat scale = MAX(1, MIN(1.5, filter.pointPixelScale));
        CGRect displayBounds = CGRectNull;
        for (SCDisplay *display in content.displays) displayBounds = CGRectUnion(displayBounds, display.frame);
        CGRect crop = WindowCrop(frame, displayBounds, scale);
        if (CGRectIsEmpty(crop)) { Reply(identifier, names, @"accessibility", @"no-visible-window", start); DebugReply(identifier, trace, NULL); return; }
        CGSize size = crop.size;
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.sourceRect = crop;
        config.width = (size_t)floor(size.width * scale);
        config.height = (size_t)floor(size.height * scale);
        config.showsCursor = NO;
        config.ignoreShadowsSingleWindow = YES;
        if (trace) {
            trace[@"source"] = @"ocr";
            trace[@"windowFrame"] = @[@(frame.origin.x), @(frame.origin.y), @(frame.size.width), @(frame.size.height)];
            trace[@"cropInWindowPoints"] = @[@(crop.origin.x), @(crop.origin.y), @(crop.size.width), @(crop.size.height)];
            trace[@"pixels"] = @[@(config.width), @(config.height)];
            CGRect visible = CGRectIntersection(frame, displayBounds);
            trace[@"pixelBudgetClipped"] = @(crop.size.width < floor(visible.size.width) || crop.size.height < floor(visible.size.height));
        }
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *captureError) {
            if (atomic_load(&captureGeneration) != generation) return;
            if (!image || captureError) { Reply(identifier, names, @"accessibility", @"capture-failed", start); DebugReply(identifier, trace, NULL); return; }
            CGImageRetain(image);
            dispatch_async(queue, ^{
                @autoreleasepool {
                    if (atomic_load(&captureGeneration) != generation) { CGImageRelease(image); return; }
                    NSMutableDictionary *ocrTrace = debug ? [NSMutableDictionary dictionary] : nil;
                    NSArray *terms = MergeNames(Recognize(image, ocrTrace), names);
                    if (trace) trace[@"ocr"] = ocrTrace;
                    if (atomic_load(&captureGeneration) != generation) { CGImageRelease(image); return; }
                    BOOL valid = SameTarget(pid, window, target);
                    Reply(identifier, valid ? terms : @[], @"ocr", valid ? @"ready" : @"target-changed", start);
                    DebugReply(identifier, trace, image);
                    CGImageRelease(image);
                    // The window watcher started before asynchronous OCR.
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
