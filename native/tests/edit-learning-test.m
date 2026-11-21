// clang -x objective-c -fobjc-arc -framework AppKit -framework ApplicationServices native/tests/edit-learning-test.m -o /tmp/spoke-learning-test
#import "../edit-learning.m"

NSArray<NSString *> *SpokeContextNames(NSString *text) { return @[]; }

static SpokeEditWatch *Fixture(void) {
    SpokeEditWatch *watch = [SpokeEditWatch new];
    watch.start = 100;
    watch.prefix = @"Before: ";
    watch.suffix = @" After.";
    watch.inserted = @"Ask Prianka.";
    return watch;
}

int main(void) {
    @autoreleasepool {
        SpokeEditWatch *watch = Fixture();
        NSCAssert([watch observe:@"Before:  After." keys:1 now:100.1] == 1 && !watch.verified, @"ACK does not prove insertion");
        NSCAssert([watch observe:@"Before: Ask Priyanka. After." keys:2 now:102] == 0 && !watch.verified, @"An unverified edited value must time out");
        watch = Fixture();
        NSCAssert([watch observe:@"Before: Ask Prianka. After." keys:1 now:100.1] == 1 && watch.verified, @"Exact insertion must verify");
        NSCAssert([watch observe:@"Before: Ask Priyanka. After." keys:2 now:101] == 1, @"Wait for stability");
        NSCAssert([watch observe:@"Before: Ask Priyanka. After." keys:2 now:102] == 1, @"One second is too soon");
        NSCAssert([watch observe:@"Before: Ask Priyanka. After." keys:2 now:102.6] == 2, @"Stable keyed edit produces candidate");
        watch = Fixture();
        [watch observe:@"Before: Ask Prianka. After." keys:1 now:100.1];
        NSCAssert([watch observe:@"Before: Ask Priyanka. After." keys:1 now:101] == 0, @"Programmatic change without user keys must stop");
        watch = Fixture();
        [watch observe:@"Before: Ask Prianka. After." keys:1 now:100.1];
        NSCAssert([watch observe:@"Changed: Ask Priyanka. After." keys:2 now:101] == 0, @"Unrelated region changes must stop");
        watch = Fixture();
        [watch observe:@"Before: Ask Prianka. After." keys:1 now:100.1];
        [watch observe:@"Before: Ask Priyanka. After." keys:2 now:101];
        [watch observe:@"Before: Ask Prianka. After." keys:3 now:101.5];
        NSCAssert([watch observe:@"Before: Ask Prianka. After." keys:3 now:104] == 1, @"Undo before stability must not produce a candidate");
        NSCAssert([watch observe:@"Before:  After." keys:4 now:105] == 0, @"Full deletion must stop");
        puts("edit-learning: 10 native assertions passed");
    }
    return 0;
}
