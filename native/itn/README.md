# Spoke inverse text normalization

The app uses the public English ITN grammars from NeMo Text Processing through
the small `spoke-itn` native helper. It sends final UTF-8 transcripts over a
persistent length-prefixed pipe. Python, Pynini, and the grammar compiler are
build-time dependencies only.

On an Apple Silicon development machine, install the native build tools once:

```sh
brew install openfst protobuf@21
npm run build:itn
```

The build clones pinned upstream revisions into the ignored `.deps/itn/`
directory, generates the FAR files, compiles the helper, and writes these
runtime resources:

* `native/bin/spoke-itn`
* `native/bin/itn-libs/`
* `native/bin/itn-grammars/en-US/`

Set `SPOKE_ITN_PYTHON` to a Python environment that has `pynini` and
`nemo_text_processing` available when generating the grammar. The normal app
development path still falls back to the raw transcript if the helper has not
been built yet; packaging fails early until the resources exist.
