#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

static void fail(NSString *message) {
    fprintf(stderr, "%s\n", message.UTF8String);
    exit(1);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) fail(@"Audio path and language are required.");
        NSString *source = [NSString stringWithUTF8String:argv[1]];
        if (![[NSFileManager defaultManager] fileExistsAtPath:source]) fail(@"Audio file not found.");
        NSLocale *locale = [NSLocale localeWithLocaleIdentifier:[NSString stringWithUTF8String:argv[2]]];
        SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
        if (!recognizer || !recognizer.supportsOnDeviceRecognition) fail(@"On-device speech recognition is unavailable for this language on this Mac.");

        __block SFSpeechRecognizerAuthorizationStatus authorization = SFSpeechRecognizerAuthorizationStatusNotDetermined;
        __block BOOL authorizationReturned = NO;
        [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
            authorization = status;
            authorizationReturned = YES;
        }];
        NSDate *authorizationDeadline = [NSDate dateWithTimeIntervalSinceNow:30];
        while (!authorizationReturned && [authorizationDeadline timeIntervalSinceNow] > 0)
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        if (authorization != SFSpeechRecognizerAuthorizationStatusAuthorized)
            fail(@"Allow speech recognition for Scene in macOS settings.");

        SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:source]];
        request.requiresOnDeviceRecognition = YES;
        request.shouldReportPartialResults = NO;
        __block SFTranscription *transcription = nil;
        __block NSError *failure = nil;
        __block BOOL completed = NO;
        SFSpeechRecognitionTask *task = [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
            if (result.isFinal) { transcription = result.bestTranscription; completed = YES; }
            if (error) { failure = error; completed = YES; }
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:600];
        while (!completed && [deadline timeIntervalSinceNow] > 0)
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        if (!completed) { [task cancel]; fail(@"Local transcription timed out."); }
        if (failure) fail(failure.localizedDescription);
        if (!transcription) fail(@"No speech was recognized in this audio.");

        NSMutableArray *captions = [NSMutableArray array];
        NSMutableArray<NSString *> *words = [NSMutableArray array];
        NSTimeInterval start = 0, end = 0;
        for (SFTranscriptionSegment *segment in transcription.segments) {
            NSString *word = [segment.substring stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!word.length) continue;
            if (!words.count) start = segment.timestamp;
            if (words.count && ([[words componentsJoinedByString:@" "] length] + word.length > 42 || segment.timestamp + segment.duration - start > 3.5)) {
                [captions addObject:@{ @"start": @(start), @"end": @(end), @"text": [words componentsJoinedByString:@" "] }];
                [words removeAllObjects]; start = segment.timestamp;
            }
            [words addObject:word]; end = segment.timestamp + segment.duration;
        }
        if (words.count) [captions addObject:@{ @"start": @(start), @"end": @(end), @"text": [words componentsJoinedByString:@" "] }];
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{ @"captions": captions } options:0 error:nil];
        fwrite(json.bytes, 1, json.length, stdout);
    }
    return 0;
}
