# Third-party notices

Spoke includes an English inverse-text-normalization runtime built from these
open-source projects. The generated FAR grammar files are data derived from
NeMo Text Processing. The app does not run Python or Pynini at runtime.

* [NVIDIA NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp), commit
  `56b60d432f1731d6d5b28a4c5a31cbaf871daba1`, Apache License 2.0. Spoke uses
  its `FstNormalizer` implementation.
* [NVIDIA NeMo-text-processing](https://github.com/NVIDIA/NeMo-text-processing),
  commit `acacc21b1cb7916b10558855bc4f85957a0b2fde`, Apache License 2.0. Spoke
  uses its public English ITN grammar exporter at build time.
* [Sparrowhawk](https://github.com/google/sparrowhawk), commit
  `8b082acc507312077a096be8398584a13832c490`, Apache License 2.0. The native
  build applies the small compatibility patch in `sparrowhawk-macos.patch`.
* [OpenFST](https://www.openfst.org/), Apache License 2.0. The native build
  uses the installed OpenFST 1.8.x libraries and bundles the two libraries
  needed by the helper.
* [RE2](https://github.com/google/re2), commit
  `4be240789d5b322df9f02b7e19c8651f3ccbf205`, BSD 3-Clause License. Spoke
  builds this older API-compatible revision to keep Abseil out of the app.
* [Protocol Buffers](https://github.com/protocolbuffers/protobuf), version
  3.21.x, BSD 3-Clause License. The build uses the `protobuf@21` formula and
  links the runtime statically into the helper.

See each project's license in its upstream repository. This file is provided
for convenient attribution alongside the packaged helper and grammar data.
