// Offline fixtures: no screen capture, OS permission prompt, or input events.
#import "../screen-context.m"

int main(void) {
    @autoreleasepool {
        CGRect window = CGRectMake(100, 100, 1190, 666);
        CGRect crop = WindowCrop(window, CGRectMake(0, 0, 1710, 1112), 1.5);
        NSCAssert(CGRectEqualToRect(crop, CGRectMake(0, 0, 1190, 666)), @"The lower paragraph must not be clipped");
        NSCAssert(!CoversWindow(CGRectMake(100, 650, 1190, 116), window, YES), @"A chat input cannot stand in for the page");
        NSCAssert(!CoversWindow(window, window, NO), @"Truncated AX text needs OCR");
        NSCAssert(CoversWindow(window, window, YES), @"A fully readable document can skip OCR");
        CGRect clipped = WindowCrop(CGRectMake(-100, 0, 1000, 700), CGRectMake(0, 0, 1710, 1112), 1.5);
        NSCAssert(CGRectEqualToRect(clipped, CGRectMake(100, 0, 900, 700)), @"Exclude offscreen pixels");
        CGRect large = WindowCrop(CGRectMake(0, 0, 6000, 4000), CGRectMake(0, 0, 6000, 4000), 1.5);
        NSCAssert(large.size.width * large.size.height * 2.25 <= 8000000, @"Bound the image allocation");
        NSArray *names = @[@"DFlash2", @"DFlash", @"GPT4o", @"Llama3", @"H2O", @"TypeScript", @"OpenAI"];
        for (NSString *name in names) {
            NSCAssert([SpokeContextNames([NSString stringWithFormat:@"Use %@ for this project.", name]) containsObject:name], @"Missing identifier: %@", name);
        }
        NSArray *ordinary = SpokeContextNames(@"Use 32px and 128mb for the 2026 report.");
        for (NSString *name in @[@"32px", @"128mb", @"2026"])
            NSCAssert(![ordinary containsObject:name], @"Unit/number must not be an identifier: %@", name);
        NSCAssert(![SpokeContextNames(@"DFla5h2 GB MB") containsObject:@"DFla5h2"], @"Reject malformed mixed identifiers");
        NSMutableString *crowded = [NSMutableString string];
        for (NSString *place in @[@"Paris", @"London", @"Berlin", @"Rome", @"Tokyo", @"Sydney", @"Melbourne", @"Boston", @"Chicago", @"Seattle", @"Toronto", @"Vancouver", @"Montreal", @"Delhi", @"Mumbai", @"Chennai", @"Bengaluru", @"Hyderabad", @"Ahmedabad", @"Kolkata", @"Singapore", @"Bangkok", @"Hanoi", @"Jakarta", @"Beijing", @"Shanghai", @"Seoul", @"Osaka", @"Kyoto"])
            [crowded appendFormat:@"Meet in %@. ", place];
        [crowded appendString:@"Use DFlash2 and NVFP4."];
        NSArray *bounded = SpokeContextNames(crowded);
        NSCAssert(bounded.count <= 24 && [bounded containsObject:@"DFlash2"] && [bounded containsObject:@"NVFP4"], @"Scan identifiers before applying the term cap");
        NSMutableArray *cases = [NSMutableArray array];
        for (NSNumber *font in @[@12, @14, @18]) for (NSNumber *scaleValue in @[@1, @1.5]) for (NSNumber *dark in @[@NO, @YES]) {
            CGFloat scale = scaleValue.doubleValue;
            NSInteger width = 960 * scale, height = 360 * scale;
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:width pixelsHigh:height bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
            [NSGraphicsContext saveGraphicsState];
            [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
            [(dark.boolValue ? NSColor.blackColor : NSColor.whiteColor) setFill];
            NSRectFill(NSMakeRect(0, 0, width, height));
            [@"Use DFlash2 for this project.\nReview TypeScript and OpenAI." drawInRect:NSMakeRect(24 * scale, 24 * scale, width - 48 * scale, height - 48 * scale)
                withAttributes:@{ NSFontAttributeName: [NSFont systemFontOfSize:font.doubleValue * scale], NSForegroundColorAttributeName: dark.boolValue ? NSColor.whiteColor : NSColor.blackColor }];
            [NSGraphicsContext restoreGraphicsState];
            NSMutableDictionary *trace = [NSMutableDictionary dictionary];
            CFAbsoluteTime start = CFAbsoluteTimeGetCurrent();
            NSArray *terms = Recognize(bitmap.CGImage, trace);
            double elapsedMs = (CFAbsoluteTimeGetCurrent() - start) * 1000;
            if (scale == 1.5) NSCAssert([terms containsObject:@"DFlash2"], @"DFlash2 missing at supported fixture scale");
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            [cases addObject:@{@"fontPoints": font, @"scale": scaleValue, @"dark": dark, @"ms": @(elapsedMs), @"detected": @([terms containsObject:@"DFlash2"]), @"ocr": trace, @"png": [png base64EncodedStringWithOptions:0]}];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"nameAssertions": @12, @"coverageAssertions": @6, @"cases": cases} options:NSJSONWritingPrettyPrinted error:nil];
        puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    }
    return 0;
}
