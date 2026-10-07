# Third-party code and development tools

## Playwright Test

Source: <https://github.com/microsoft/playwright>

License: Apache-2.0

Usage:

- Development-only browser automation for Git Chronos renderer tests.
- No Playwright source code is copied or adapted into this repository.

Required notices:

- Playwright and its browser downloads retain their upstream license and notice
  files in their distributed packages.

## notify

Source: <https://github.com/notify-rs/notify>

License: CC0-1.0

Usage:

- Cross-platform filesystem notifications for Git metadata directories.
- Git Chronos supplies its own event coalescing and repository refresh logic.
- No notify source code is copied or adapted into this repository.

Required notices:

- None required by CC0-1.0; provenance is retained here for transparency.

## gitoxide (`gix`)

Source: <https://github.com/GitoxideLabs/gitoxide>

License: MIT OR Apache-2.0

Usage:

- In-process object and reference access for incremental commit history
  paging, avoiding one Git process per page in very large repositories.
- Git Chronos supplies its own date-ordered walk and output formatting,
  verified against `git log` output; reference tips and decorations still come
  from the Git CLI.
- No gitoxide source code is copied or adapted into this repository.

Transitive licenses outside MIT/Apache-2.0:

- `zlib-rs`, `foldhash`: Zlib (`tinyvec`: Zlib OR Apache-2.0 OR MIT).
- `uluru`: MPL-2.0, used unmodified as a library dependency.
- `unicode-ident`: (MIT OR Apache-2.0) AND Unicode-3.0.

Required notices:

- Binary distributions must retain the MIT/Apache-2.0, Zlib, MPL-2.0, and
  Unicode-3.0 license texts of these crates; MPL-2.0 additionally requires
  informing recipients where the `uluru` source is available
  (<https://github.com/servo/uluru>).
