// Preserve every native pasteboard item and type around the scratch benchmark.
#import <AppKit/AppKit.h>
int main(void) {
    @autoreleasepool {
        NSPasteboard *pb = NSPasteboard.generalPasteboard;
        NSMutableArray *saved = [NSMutableArray array];
        for (NSPasteboardItem *item in pb.pasteboardItems) {
            NSMutableDictionary *types = [NSMutableDictionary dictionary];
            for (NSString *type in item.types) {
                NSData *data = [item dataForType:type];
                if (data) types[type] = data;
            }
            [saved addObject:types];
        }
        puts("ready"); fflush(stdout);
        while (getchar() != EOF) {}
        NSString *text = [pb stringForType:NSPasteboardTypeString];
        // Do not restore over a user copy made while the benchmark ran.
        if ([text hasPrefix:@"SpokeBenchmark"] || [text hasPrefix:@"MCP and Marble"] || [text isEqualToString:@"continue here. "]) {
            NSMutableArray *items = [NSMutableArray array];
            for (NSDictionary *types in saved) {
                NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
                for (NSString *type in types) [item setData:types[type] forType:type];
                [items addObject:item];
            }
            [pb clearContents];
            [pb writeObjects:items];
        }
    }
    return 0;
}
