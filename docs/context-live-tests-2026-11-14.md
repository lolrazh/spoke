# Local context live tests — 14 November 2026

Tests ran in the development app on the Mac’s Virtual 16:9 display. These are local microphone and paste tests, not a packaged-release certification.

## Method

- A native helper focused only named test windows on the virtual display and sent real Right Option down/up events. The user approved this automation.
- Local Samantha speech played through the Mac speakers into the default Mac microphone. The test used a one-second lead-in after key-down. Spoke ran microphone capture, VAD, local Parakeet, local correction, and its normal paste helper.
- TextEdit held the names in an accessible document. Safari and Dia used a localhost page with the names drawn on a canvas near the bottom. The canvas text was absent from Accessibility.
- Each field was cleared before a run. Native AX readback checked the inserted text against the final transcript, allowing only surrounding whitespace and case differences. CUA also confirmed visible results.
- The full phrase was “Use D flash two for this project. Test N, V, F, P, four as well.” The short phrase was “D flash two.” No audio device or volume preference was changed.

## Repeat matrix before the final timing changes

This nine-run matrix followed the window-capture and acronym fixes. Later tests below led to additional idle-worker and context-consumption changes. It must not be treated as nine trials of the final commit.

| App | Path | Context names found | Paste matched final text | Both names in output | Context ready (ms) |
| --- | --- | --- | --- | --- | --- |
| TextEdit | accessibility | 3/3 | 3/3 | 2/3 | 553, 139, 114 |
| Safari | ocr | 3/3 | 3/3 | 3/3 | 4315, 1252, 1558 |
| Dia | ocr | 3/3 | 3/3 | 3/3 | 1992, 2044, 1748 |

The TextEdit name failure contained `N, E, F, P, 4`. Correction kept the commas. The selected lists had 4 terms in TextEdit, 8 in Safari, and 5 in Dia, below the 24-term cap. Browser UI labels added some noise, but the cap did not exclude either target name. Native insertion took 40–119 ms in these nine runs; this excludes recognition time and is not an A/B performance comparison.

## Final consumption-timing build

| Case | App | Context ready (ms) | Context names found | Inserted text | Paste matched |
| --- | --- | --- | --- | --- | --- |
| consume-safari-full | Safari | 2092 | yes | Use DFlash2 for this project. Test NVFP4 as well. | yes |
| consume-safari-short-1 | Safari | 438 | yes | DFlash2. | yes |
| consume-textedit-full | TextEdit | 350 | yes | Use DFlash2 for this project. Test NVFP4 as well. | yes |
| consume-safari-short-after-idle | Safari | 1944 | yes | DFlash2. | yes |

## Failures found and changes made

1. Desktop-independent window capture returned ScreenCaptureKit error `-3811` on the virtual display. Capture now uses a display filter that includes only the target window. Geometry checks cover an offset external display and a window spanning displays.
2. ScreenCaptureKit initialized AppKit on the main queue during capture. A worker sample showed target validation blocked behind this initialization. Idle preparation now initializes AppKit and Vision without reading screen text or pixels. One worker remains ready while the feature is enabled; dictation terms are still cleared each time.
3. A browser’s AX frontmost flag stayed true during a deliberate app switch. The final code uses the OS active-app check, plus AX window identity. The native switch test rejected the capture after moving from Dia to TextEdit. Missing AX identity attributes get one bounded retry, and debug stages record the reason for rejection.
4. `T flash 2` needed a guarded voiced-initial correction. Spelled acronym normalization also transformed `N P F P 4` into `NPFP 4` before dictionary matching. Both forms now use a unique numbered-acronym match. Digits, ambiguous alternatives, ordinary conjunctions, and punctuation boundaries remain protected.
5. A short run ended at 4,051 ms; OCR finished at 4,081 ms while Parakeet was still decoding. Freezing at speech stop discarded usable context. Whisper now freezes at prompt submission; other local models freeze immediately before final correction. Neither path waits for OCR. The capture work limit is eight seconds.
6. Diagnostic records now include capture stages and native capture errors, so a terminated worker does not erase the location of a stall. Recording remains opt-in.

## Controls and limits

- Removing the reference names in Dia produced a new dictionary with neither `DFlash2` nor `NVFP4`. Ordinary control text was unchanged and pasted correctly. No prior screen terms leaked into that control.
- An idle-worker sample showed about 33 MB before capture and 42–62 MB after use, with 0% CPU at the sampled idle times. The same worker remained alive beyond the former one-minute shutdown.
- Earlier short runs failed when OCR arrived after the old freeze boundary. Other acoustic playback runs produced `and VFP4`, `St flash 2`, comma-separated letters, or omitted opening words. Those failures are retained in the local data. They are not counted as successful recognition merely because paste matched.
- Recognition is not perfect. These speaker-to-microphone tests do not establish human-speech accuracy or microphone-start readiness for immediate speech. The remaining startup/audio-recognition failures need separate work; dictionary correction must not fabricate missing speech.
- First capture after startup and captures under load still took several seconds in some runs. If context is not ready by its point of use, Spoke omits it instead of delaying dictation or paste.
- Screen capture, OCR, tagging, correction, and test records stayed local. No cloud OCR was used. These tests do not cover every app, secure fields, live permission revocation, or live verified-edit learning.

## Checks and local evidence

- 675 tests across 76 files passed. The final run used two Vitest workers and a 15-second per-test limit after an earlier run timed out under system load; no test source timeout was relaxed. TypeScript passed. ESLint had no errors and 18 warnings.
- Native name/coverage assertions and 12 OCR fixtures passed their expected assertions. Ten of the 12 fixtures detected `DFlash2`; all six at 1.5x did. Small 1x text remains a known Vision fast-mode limit.
- Local debug sets are under `~/Library/Application Support/Spoke/context-debug/`. Raw screen text, audio, images, and saved personal vocabulary are not committed or uploaded.
- Initial repeat set: `2026-11-13T20-21-50-188Z-9ea108f3`.
- Final timing set: `2026-11-13T21-33-02-384Z-43b2af42`.
- The local evidence bundle beside the final set contains the native driver source, localhost fixture, run results, and focus-switch trace. Run IDs below map each final check to its JSON, image, and audio in the app’s debug viewer.

- `consume-safari-full`: `87759bea-d3fa-4df1-b649-f7561ecafa07`
- `consume-safari-short-1`: `dbe1f701-9a33-4ace-a3bb-e26bdb779cd7`
- `consume-textedit-full`: `e7b6f7ae-45c1-4acd-8fcd-1edbb2bf7fa6`
- `consume-safari-short-after-idle`: `07035951-0c10-46be-acbe-bd18d88370be`


## Follow-up: capture latency and zero added speech delay

This follow-up keeps the audio/first-word investigation on hold at the user's request. It changes screen context, not microphone startup, VAD, or Parakeet decoding.

### Dictionary behavior

The two post-transcription matching methods are Double Metaphone (sound-based) and spelling distance, with additional bounded identifier/acronym rules. The current Parakeet MLX adapter explicitly ignores the shared prompt argument. Whisper alone receives the vocabulary hint before decoding. NVIDIA NeMo supports decoder phrase boosting for TDT models, but that is not integrated into Spoke's adapter: https://docs.nvidia.com/nemo/speech/nightly/asr/asr_customization/word_boosting.html.

### Changes

- Stop AX traversal after a complete document is read. When screen permission is available, use a 40 ms traversal budget before OCR fallback; retain the 120 ms budget when AX is the only available source. These are traversal budgets, not hard end-to-end timing guarantees for OS calls.
- Start window metadata lookup alongside AX traversal. Take a screenshot only if AX coverage is incomplete. Capture still includes only the target window, with the same pixel budget and scale.
- Prepare name tagging with fixed synthetic text as well as AppKit and Vision. A blank warmup image does not exercise name tagging. Warmup emits a readiness event, which cannot change a dictation's vocabulary. Queued synthetic work is skipped if capture has already started.
- Use the screenshot-specific API on macOS 26 or newer, with a compile-time SDK guard and the existing API as fallback. No continuously running screen stream or cached screen text was added.
- Guard shortcut cleanup with `app.isReady()`. Cancelling an app launch before readiness had opened an Electron error dialog. The test harness's process cleanup was also corrected; aborted launches are excluded from capture measurements.

### Matched helper measurements

Safari displayed the same pixel-only reference page on the virtual display. Each sample used a new native worker. Prepared workers received the warm command two seconds before capture; that is idle preparation, not a speech delay. The timer starts when the capture command is sent. Both names were found in every sample below.

| Worker state | Previous build, ms | New screenshot path, ms | Median change |
| --- | --- | --- | --- |
| Fresh process | 619, 319, 306 | 258, 268, 276 | 319 to 268 ms (16% lower) |
| Prepared process | 246, 248, 252 | 198, 188, 193 | 248 to 193 ms (22% lower) |

These are three trials per condition on one window, with OS caches already in use. They are not reboot-cold measurements or a guarantee under load. The earlier multi-second runs are not a matched baseline. Earlier exploratory trials with focus changes or the wrong foreground app are excluded. The old screenshot API fallback was exercised before the API change; this host cannot certify older macOS releases.

### Real dictation, zero added delay

The native driver loads and prepares local audio before Right Option down, then requests playback with no sleep. The measured playback call completed 39–60 ms after the key event in the final four runs; this is not a measurement of physical sound onset. Audio still travels through the Mac speakers and microphone. Each cold run starts a fresh development app; normal idle prewarming remains enabled. The final cold tests began about 186–218 ms after the app's ready signal, plus test-driver setup.

| Case | Context ready | Names found | Recognition/output | Paste |
| --- | --- | --- | --- | --- |
| Fresh app, full phrase | 655 ms | DFlash2, NVFP4 | Opening phrase absent; remaining acronym corrected | Matched non-empty final text |
| Fresh app, short phrase | 781 ms | DFlash2, NVFP4 | No transcript | No paste; not a success |
| Prepared app, full phrase | 154 ms | DFlash2, NVFP4 | EFLASH 2 remained; NVFP4 corrected | Matched non-empty final text |
| Prepared app, short phrase | 150 ms | DFlash2, NVFP4 | Yeah. | Matched non-empty final text |

Context arrived before speech stopped in all four runs. These are 4/4 context-coverage checks and 3/3 non-empty paste-readback checks, but **zero full recognition successes** for the requested phrases. They do not establish human-speech accuracy. No broader correction rule was added to force these results to match. The user asked to hold the opening-word investigation, so capture/VAD/recognition behavior remains unchanged.

The driver now cancels the owned development app if focus leaves the named test window, including while awaiting paste. Earlier focus-interrupted attempts are not successful tests. Test windows and the loopback server were closed after verification. Raw audio, screenshots and screen terms stay local.

### Verification and evidence

- 676 tests in 76 files passed; TypeScript and targeted ESLint checks passed.
- Native geometry/name assertions and the 12 OCR fixtures passed their expected assertions (10/12 detect DFlash2, including all six at 1.5x).
- Standalone synthetic startup returned only `warm-ready` in 73 ms in one probe; it did not capture screen content.
- Local comparison files: `/tmp/spoke-context-speed/baseline-matched.json` and `/tmp/spoke-context-speed/new-api.json`.
- Final live sets: `2026-11-14T04-00-30-949Z-8ac5feb1` and `2026-11-14T04-01-08-047Z-1d83e5c2`.
- Final run IDs: `a07b52f9-734e-42e8-92b4-d27c5b840d89`, `2bcc81ac-6773-4ad7-bf78-f04e93e48174`, `18ecc531-4523-4f66-9e84-eea26e958fbc`, `fe85c65b-e14c-44ad-ad64-4bf37066fbb0`.


## Work log checkpoint before decoder-boosting research

Recorded 14 November 2026. Work is on `codex/context-consistency`, in draft PR #42, not on main. The original checkout contains unrelated work and was left unchanged.

1. Investigated Wispr Flow and Willow Voice to identify local context and edit-learning approaches. Static vendor artifacts are evidence of available paths, not proof of their runtime behavior or an entirely local service.
2. Added a separate local screen-context helper: Accessibility first, Vision OCR fallback, Apple name tags plus identifier rules, bounded temporary vocabulary, and target/session invalidation. Added verified small-edit learning with same-field readback and repeated evidence.
3. Added opt-in local diagnostics for capture stages, text coverage, Apple tags, selected terms, decoder output, correction, and optional audio/images. These records are not uploaded.
4. Fixed the DFlash2 coverage and numbered-acronym paths, virtual-display screenshot failure, active-app validation, and late context consumption. Whisper uses vocabulary hints at decode time; the current Parakeet MLX adapter uses local correction after decoding.
5. Tested real hotkey, microphone, correction, and paste flows in TextEdit, Safari, and Dia. The matrices above distinguish context detection, recognition accuracy, and actual field readback. Verified-edit learning was not live-tested in that matrix.
6. Reduced capture work and added synthetic name-tagging preparation. The newer macOS screenshot API reduced the matched fresh-worker median from 319 to 268 ms and the prepared-worker median from 248 to 193 ms. Zero-added-delay playback tests captured the screen terms but did not establish recognition accuracy. Audio/VAD changes are on hold at the user's request.
7. Committed the work in small steps and pushed draft PR #42. At this checkpoint, 676 tests, TypeScript, targeted ESLint, and native expected assertions passed. The normal development app was restarted with diagnostic recording off.

Next scope: verify dependency versions and upstream changes; inspect existing local Parakeet word-boosting implementations; assess a decoder integration without cloud processing or extra encoder work. UI cleanup and user-facing controls will be revisited later. No upstream contribution has been submitted.

### Decoder research outcome

The [word-boosting report](parakeet-word-boosting-2026-11-14.md) records the installed stack, current upstream releases, alternative frameworks, and local prototype results. Upstream `parakeet-mlx` 0.7.0 has a reusable beam-search booster. Two terms corrected the synthetic name clips, but a 24-term list produced false names and raised word error rate on 32 independent speech controls. The benchmark is checked in; inference data remains local. Normal dictation and dependency pins are unchanged because the broader term list failed the accuracy checks. No UI change or upstream contribution was made.
