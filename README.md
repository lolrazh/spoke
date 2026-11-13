# Spoke

**Free, MIT-licensed dictation for Apple Silicon Macs.**

Spoke turns your voice into text at the cursor in your Mac apps. Speech recognition
runs on your Mac. No account, subscription, or API key is required.

Made by [Sandheep Rajkumar](https://sandheep.xyz). This is the Spoke app at
[spoke.so](https://www.spoke.so/), with source code at
[lolrazh/spoke](https://github.com/lolrazh/spoke).

[Download for Mac](https://github.com/lolrazh/spoke/releases/latest/download/Spoke-arm64.dmg)
· [Website](https://www.spoke.so/)
· [Release notes](https://github.com/lolrazh/spoke/releases)
· [Report an issue](https://github.com/lolrazh/spoke/issues)

## Requirements

- An Apple Silicon Mac (M1 or later).
- macOS 26.2 or later for the current release.
- An internet connection to download the app, speech models, and app updates.

After model setup, dictation works offline. Intel Macs, Windows, and Linux are not
supported by this app.

## Start dictating

1. Download the DMG, then move Spoke to Applications and open it.
2. Follow setup to grant Microphone, Accessibility, and Input Monitoring access.
   Restart Spoke when setup asks you to do so.
3. Download a speech model. Parakeet is the default for English.
4. Put your cursor in a text field. Hold **Right Option**, speak, then release the
   key to insert your text.

Each recording can be up to five minutes long. You can start another recording
after it ends. There is no paid plan or weekly word quota.

## Stay in your writing flow

- **A small floating pill** shows listening and processing feedback while you
  stay in the app where you write.
- **Live transcripts with Nemotron** show words while you speak.
- **Dictionary** lets you add names, phrases, and technical terms. Spoke can
  correct close matches across its local speech models.
- **Cursor-aware insertion** fits text around the cursor and can add a space
  after dictation.
- **Local history** lets you return to saved transcripts.

These are features of Spoke at `spoke.so`. Other products with the same or similar
names can have different features, prices, and privacy rules.

## Choose a local speech model

| Model | Language support in Spoke's registry | Use |
| --- | --- | --- |
| Parakeet TDT 0.6B v2 | English | Default model for English dictation |
| Nemotron 3.5 ASR Streaming 0.6B | 40 languages | Live transcripts |
| Cohere Transcribe 03-2026 | 14 languages | Multilingual dictation |
| Whisper Large-v3 Turbo | 99 languages | Broad language coverage, including English, Spanish, and Japanese |

Language support depends on the selected model. The default Parakeet model is
English-only. Support for several languages does not guarantee accurate mixed
language speech within one sentence. Try your own names, accent, and microphone.

The model list, download files, integrity hashes, and language metadata are in
[`src/main/localModelContract.ts`](src/main/localModelContract.ts). Spoke runs
local speech recognition through a Python sidecar and MLX-based model packages.
It does not use a cloud transcription service for dictation.

## Privacy and offline use

Dictated audio is processed on your Mac. It is not uploaded to a cloud
transcription service. Speech models are downloaded during setup. App updates and
new model downloads need an internet connection; dictation with an installed
model does not.

The app keeps transcript history on your Mac. Website analytics are separate from
the app's local speech recognition.

### Local screen context and edit learning

The Dictionary view has two independent controls, enabled by default:

- **Use names from the active window** starts a separate local helper when
  dictation starts. It reads Accessibility text first. A few names from an input
  or sidebar do not prove that the main text was read. Unless a complete text
  area covers at least 80% of the window, it supplements those terms with local
  Apple Vision OCR. OCR needs the
  optional screen recording permission; the app requests it only from the
  **Allow local screen reading** button. It reads the visible window at
  1–1.5 pixels per point, with an 8-million-pixel limit. An oversized window is
  cropped around its centre; debug records show when that limit clipped it.
  It does not reduce a full window to a small, unreadable image.
- **Learn verified name corrections** first checks that the exact pasted text
  appears in the same Accessibility field. It watches that field for up to
  30 seconds, then accepts only a small name correction after 1.5 seconds
  without further changes. The same correction must occur in two separate
  dictations within 10 minutes before it enters the dictionary. Remove a
  learned name to undo and prevent automatic learning of that name.

Screen context uses local name tagging. It keeps at most 24 temporary terms;
it does not save images or raw screen text. Whisper receives the terms as
vocabulary hints. Other models use the existing local dictionary correction
step because they do not accept this prompt. No context or edit text is sent
to a server. Only accepted word pairs and removal preferences are saved.

Context never waits on the paste path. Results that are not ready when speech
stops are skipped. A context worker that stalls is stopped after four seconds.
That background budget allows cold initialization while speech continues; it
does not extend recording or delay paste. Idle preparation warms the worker,
but a cold capture never queues behind an extra synthetic OCR request.
App/window changes and protected fields discard context. Moving focus within
the same window keeps its context. Starting another dictation stops edit watching.
Learning skips protected fields, unsupported AX fields, and documents whose
initial text exceeds 4096 characters. Paste still works without learning.
OCR uses Vision's fast path; name coverage depends on the language and app.
Name extraction combines Apple's person/place/organization tags with rules
for product identifiers, including `DFlash2`. Identifiers take priority over
generic name tags and plain acronyms when the 24-term limit is reached.
Numbered identifiers match their complete spoken spelling (`D flash two`).
One letter in an uppercase numbered acronym can be corrected (`NBFP4` to
`NVFP4`) only if there is one matching candidate. Exact entries win; ambiguous
matches stay unchanged. Matching cannot insert, remove, or change digits.
For a separately spoken initial, a voiced/unvoiced pair such as D/T can match
only when the rest of the complete numbered identifier is exact and unique.
Verified edit learning uses the same full-spelling
check for names with digits. It does not learn version changes.

To check the native components without reading a real screen:

```sh
bash native/build-helper.sh
'native/bin/Spoke Helper.app/Contents/MacOS/Spoke Helper' --context-benchmark
clang -x objective-c -fobjc-arc -framework AppKit -framework ApplicationServices native/tests/edit-learning-test.m -o /tmp/spoke-learning-test
/tmp/spoke-learning-test
```

The benchmark uses a synthetic image. Its time includes OCR and name tagging,
but excludes screen capture and IPC. It is not an end-to-end latency guarantee.

### Save and inspect context tests

Open **Dictionary → Context debugging**, name a test set, and select **Start
test set**. Switch to another app and dictate normally. Return to the Dictionary
view, choose a run, and add the expected text and notes.

The viewer shows Accessibility text, the exact OCR crop and its position in the
window, OCR confidence, Apple's name tags, identifier-rule matches, selected
terms, model input, raw speech output, and local correction decisions. A saved
image exists only when the production path used OCR. The final-text field is
the text sent toward insertion, not proof that another app displayed it.

Test sets stay in `context-debug` under Electron's user-data directory. Use
**Open set folder** to find the JSON records and PNG files. Optional audio is
saved as 16 kHz mono PCM WAV clips, using the audio sent to speech recognition.
Audio must be enabled when starting the set. Saving is off by default, stops
after 50 runs, and does not resume after an app restart. **Stop saving** prevents
new runs; an existing run can still finish. **Delete this run** removes its
record, image, and audio files. Nothing is uploaded.

For a development-only live test, a launch flag can start the same local set:

```sh
SPOKE_CONTEXT_TEST_SET="Virtual display live tests" SPOKE_CONTEXT_TEST_AUDIO=1 npm start
```

Omit the audio flag to save text and images only. Packaged apps ignore both
flags. Restart without these flags when the test is complete.

Debug mode does extra work, so use it to diagnose accuracy, not to measure
normal-mode performance. File writes do not block on the dictation path. PNG
encoding happens after the native worker sends the normal context result.

Replay saved text with the current name extractor and correction code:

```sh
node scripts/replay-context-debug.mjs "/path/from/Open set folder"
```

This creates a `replay-*.json` comparison report in the same set. It does not
re-decode audio, change the dictionary, or change the original test records.
It reports new extracted terms separately; correction replay uses each run's
saved dictionary to isolate changes in the correction algorithm.

Run the offline image-to-text integration probe:

```sh
node scripts/test-context-pipeline.mjs /tmp/spoke-context-checks
```

This checks native name extraction, 12 light/dark OCR fixtures, session freeze,
local text correction, edit-candidate filtering, and saved-set reload. It saves
the failing cases too. Small dark text at 1 pixel per point can still be read
incorrectly by Vision fast mode; the tested 1.5x fixtures pass. These fixtures
do not verify live Accessibility capture, microphone input, or paste into an
external app. Optional second and third arguments accept a local ASR report
(`results[0].raw`) and its 16 kHz mono PCM16 WAV file.

To test a screenshot with the production crop policy, save the raw transcript
and expected result in two text files, then run:

```sh
node scripts/test-context-image.mjs image.png raw.txt expected.txt /tmp/context-result.json
```

This runs ten repeats at each of two display scales. The local report includes
selected terms, correction decisions, and timing. It does not capture a live
screen, decode audio, or paste text.

## Build and contribute

The app uses Electron, TypeScript, React, native macOS helpers, and a local Python
speech runtime. The app repo uses npm. The marketing site is a separate project.

Use an Apple Silicon Mac with the Xcode Command Line Tools installed. Install the
Node.js and Python versions used in
[the release workflow](.github/workflows/release.yml), then run:

```sh
npm ci
python3 -m venv local-stt/.venv
npm run setup:stt
npm start
```

`npm ci` builds the native helpers. `setup:stt` installs the pinned speech runtime
dependencies into `local-stt/.venv`. Download a model in the app before dictation.
Release signing and notarization use the settings in `.env.example`.

Run the checks that match your change:

```sh
npm test
npm run lint
```

See [the release notes guide](releases/README.md) for the release process.

## License

Spoke's application code is available under the [MIT License](LICENSE).
Third-party dependencies and speech-model weights retain their own licenses.
