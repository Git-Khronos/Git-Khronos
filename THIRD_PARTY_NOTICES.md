# Third-party notices

## aho-corasick 1.1.5

Source: <https://github.com/BurntSushi/aho-corasick>

The MIT license option is selected for this unmodified library dependency.

The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Tokio 1.53.3

Source: <https://github.com/tokio-rs/tokio>

MIT License

Copyright (c) Tokio Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## rustix 1.1.5

Source: <https://github.com/bytecodealliance/rustix>

The MIT license option is selected for this unmodified library dependency.
Upstream contributor notice:

Copyrights in the `rustix` project are retained by their contributors.
No copyright assignment is required to contribute to the `rustix` project.
Some files include code derived from Rust's `libstd`; see the comments in
the upstream code for details.

MIT license terms:

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

## Specta and Tauri Specta

The generated IPC boundary uses the unmodified MIT-licensed `specta`,
`specta-typescript`, and `tauri-specta` crates by the Specta contributors.
Versions, canonical sources, usage, and license verification are recorded in
`docs/provenance/third-party-code.md`. Their upstream MIT terms apply to those
dependencies; no upstream source is copied into this repository.

## Nx agent tooling

The Nx guidance in `AGENTS.md`, the Nx skills and CI-monitor scripts in
`.agents/skills/`, and the Nx-related `.codex/` integration are copied or adapted
from Narwhal Technologies' MIT-licensed Nx tooling. This notice applies to those
Nx materials, not to unrelated skills in the same directory. Sources, snapshot
identifier and local adaptations are recorded in
`docs/provenance/third-party-code.md`.

(The MIT License)

Copyright (c) 2017-2026 Narwhal Technologies Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Lucide Icons

The SVG icon paths in `apps/desktop/src/app/icon.component.ts` are adapted from
the Lucide icon project. Lucide is available under the ISC License; some Lucide
icons are derived from Feather Icons under the MIT License.

### ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

### Feather Icons MIT License

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Rust crate dependencies

Git Khronos links third-party Rust crates that are used unmodified and retain
their upstream licenses. The gitoxide (`gix`) crates are available under
MIT OR Apache-2.0. Its dependency `uluru` is available under the Mozilla Public
License 2.0, and its source code is available at
<https://github.com/servo/uluru>. See `docs/provenance/third-party-code.md` for
the license review of these dependencies.

## Unix terminal I/O: libc

Source: <https://github.com/rust-lang/libc>, version 0.2.190.
License: MIT OR Apache-2.0; this distribution uses the MIT option.
Used unmodified for Unix descriptor flags and readiness polling.

Copyright (c) The Rust Project Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Cached Git attribute resolution dependencies

Enabling gitoxide attribute resolution also uses the unmodified crates
`gix-submodule 0.36.1` (MIT OR Apache-2.0), `dashmap 6.2.1` (MIT), and
`hashbrown 0.14.5` (MIT OR Apache-2.0). The MIT option is used here.
SHA-256 support additionally uses `sha2 0.11.1`, `digest 0.11.3`,
`crypto-common 0.2.2`, `block-buffer 0.12.1`, `cpufeatures 0.3.1`, and
`hybrid-array 0.4.15`, all MIT OR Apache-2.0, using the MIT option.

Sources:

- <https://github.com/GitoxideLabs/gitoxide>
- <https://github.com/xacrimon/dashmap>
- <https://github.com/rust-lang/hashbrown>
- <https://github.com/RustCrypto/hashes>
- <https://github.com/RustCrypto/traits>
- <https://github.com/RustCrypto/utils>
- <https://github.com/RustCrypto/hybrid-array>

DashMap: Copyright (c) 2019 Acrimon

Hashbrown: Copyright (c) 2016 Amanieu d'Antras

SHA2:

Copyright (c) 2016-2026 The RustCrypto Project Developers
Copyright (c) 2016 Artyom Pavlov
Copyright (c) 2009-2013 Mozilla Foundation
Copyright (c) 2006-2009 Graydon Hoare

Block-buffer: Copyright (c) 2018-2025 The RustCrypto Project Developers

CPUfeatures: Copyright (c) 2020-2026 The RustCrypto Project Developers

Crypto-common: Copyright (c) 2021-2026 RustCrypto Developers

Digest:

Copyright (c) 2017-2025 RustCrypto Developers
Copyright (c) 2017 Artyom Pavlov

Hybrid-array: Copyright (c) 2022-2026 The RustCrypto Project Developers

MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
