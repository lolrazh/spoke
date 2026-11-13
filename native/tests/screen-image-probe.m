// Replay an image through the production OCR/name extractor. No screen access.
// argv: image [x y width height outputWidth [outputPNG]], in input-image pixels.
#import "../screen-context.m"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2 && argc != 7 && argc != 8) return 2;
        NSBitmapImageRep *input = [NSBitmapImageRep imageRepWithData:[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]]];
        if (!input) return 3;
        CGImageRef original = input.CGImage;
        CGRect region = CGRectMake(0, 0, CGImageGetWidth(original), CGImageGetHeight(original));
        if (argc >= 7) region = CGRectMake(atof(argv[2]), atof(argv[3]), atof(argv[4]), atof(argv[5]));
        CGImageRef crop = CGImageCreateWithImageInRect(original, region);
        if (!crop) return 4;
        size_t width = argc >= 7 ? (size_t)atoi(argv[6]) : CGImageGetWidth(crop);
        size_t height = ceil((double)CGImageGetHeight(crop) * width / CGImageGetWidth(crop));
        if (!width || !height || width > 10000 || height > 10000) { CGImageRelease(crop); return 5; }
        CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, color, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
        CGColorSpaceRelease(color);
        if (!context) { CGImageRelease(crop); return 6; }
        CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
        CGContextDrawImage(context, CGRectMake(0, 0, width, height), crop);
        CGImageRelease(crop);
        CGImageRef image = CGBitmapContextCreateImage(context);
        CGContextRelease(context);
        NSMutableDictionary *trace = [NSMutableDictionary dictionary];
        CFAbsoluteTime start = CFAbsoluteTimeGetCurrent();
        NSArray *terms = Recognize(image, trace);
        double elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000;
        if (argc == 8) {
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
            [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[NSString stringWithUTF8String:argv[7]] atomically:YES];
        }
        CGImageRelease(image);
        NSDictionary *report = @{@"scope": @"Uploaded-image replay, not a live capture", @"inputPixels": @[@(input.pixelsWide), @(input.pixelsHigh)], @"cropInputPixels": @[@(region.origin.x), @(region.origin.y), @(region.size.width), @(region.size.height)], @"ocrPixels": @[@(width), @(height)], @"ms": @(elapsed), @"terms": terms, @"ocr": trace};
        NSData *json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];
        puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    }
    return 0;
}
