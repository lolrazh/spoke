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
