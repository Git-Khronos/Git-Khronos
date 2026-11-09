# Third-party code and development tools

## GitLab HTTPS dependencies

The secondary candidate manifest directly requests reqwest 0.13.5
(`MIT OR Apache-2.0`, <https://github.com/seanmonstar/reqwest>) and Tokio 1.53.3
(`MIT`, <https://github.com/tokio-rs/tokio>). Their exact published local manifests
and license files were inspected. The MIT terms are compatible with this
repository's GPL-3.0-only license; preserve the upstream copyright and terms in
the distribution's dependency notices. No implementation source was copied into
the repository.

Both package versions already appear transitively in the base lockfile. The
candidate selects native TLS and Tokio runtime features. Resolution adds fifteen
packages and removes or updates none of the existing package/version identities.
The added declarations are MIT and/or Apache-2.0; published notice files are
present and retained by the existing notice collector.

| Package | Version | Declared license | Canonical source |
| --- | --- | --- | --- |
| foreign-types | 0.3.2 | MIT/Apache-2.0 | https://github.com/sfackler/foreign-types |
| foreign-types-shared | 0.1.1 | MIT/Apache-2.0 | https://github.com/sfackler/foreign-types |
| hyper-tls | 0.6.0 | MIT/Apache-2.0 | https://github.com/hyperium/hyper-tls |
| native-tls | 0.2.18 | MIT OR Apache-2.0 | https://github.com/rust-native-tls/rust-native-tls |
| openssl | 0.10.81 | Apache-2.0 | https://github.com/rust-openssl/rust-openssl |
| openssl-macros | 0.1.1 | MIT/Apache-2.0 | https://github.com/rust-openssl/rust-openssl |
| openssl-probe | 0.2.2 | MIT OR Apache-2.0 | https://github.com/rustls/openssl-probe |
| openssl-sys | 0.9.117 | MIT | https://github.com/rust-openssl/rust-openssl |
| rustls-pki-types | 1.15.1 | MIT OR Apache-2.0 | https://github.com/rustls/pki-types |
| schannel | 0.1.30 | MIT | https://github.com/steffengy/schannel-rs |
| security-framework | 3.7.0 | MIT OR Apache-2.0 | https://github.com/kornelski/rust-security-framework |
| security-framework-sys | 2.17.0 | MIT OR Apache-2.0 | https://github.com/kornelski/rust-security-framework |
| tokio-native-tls | 0.3.1 | MIT | https://github.com/tokio-rs/tls |
| vcpkg | 0.2.15 | MIT/Apache-2.0 | https://github.com/mcgoo/vcpkg-rs |
| zeroize | 1.9.0 | Apache-2.0 OR MIT | https://github.com/RustCrypto/utils |

The openssl-macros published repository field is absent and remains absent in
metadata. Its published VCS record identifies revision
`29d993ffaad363b2bfae80434d57d428ef25484d`, path `openssl-macros`. The exact
[upstream manifest](https://github.com/rust-openssl/rust-openssl/blob/29d993ffaad363b2bfae80434d57d428ef25484d/openssl-macros/Cargo.toml)
matches the published original and establishes the canonical source above.
Both published MIT and Apache notices are present; no missing-notice exception
or invented repository metadata was added.

Locked offline notice collection passes for the Linux conservative normal/build
closure, 468 packages, in `parity-gitlab-notice-collection-run`. This includes
actual reqwest, Tokio and native-TLS dependency terms. It is not an exact
linked-artifact SBOM or legal approval. Compilation, behavioral tests and
exact-package verification pass as recorded in the GitLab specification. The adapter and
TLS fixtures are independently written; no upstream implementation was copied.

The native session timer directly uses the same pinned Tokio version and existing
runtime/time features. The subsequent offline resolution adds no further package
versions, and `parity-gitlab-native-notice-collection-run` again passes for the
468-package Linux conservative closure. The exact qualified Linux Deb contains
that catalogue (SHA-256 `8b664da372f502e532c1db55e844fffaa369ef6570619b5558f5f367137a6fa7`).
Platform-only Windows/macOS packages are not included in this Linux catalogue.
See [packaged qualification](../specifications/gitlab-projects.md) for the
separate runtime and dependency checks; this remains a conservative catalogue,
not an exact linked-artifact SBOM.

## Frontend dialog-plugin notice supplement

The published `@tauri-apps/plugin-dialog 2.8.1` npm package declares
`MIT OR Apache-2.0` but ships only `LICENSE.spdx`. Official versioned registry
metadata identifies upstream revision
`d4835d0e947179bac24a383212792d74be3ebe4f` in
<https://github.com/tauri-apps/plugins-workspace>. Its archive integrity matches
the exact `pnpm-lock.yaml` entry; the upstream dialog manifest also matches the
installed manifest's SHA-256 and Git blob.

The exact `LICENSE_MIT` and `LICENSE_APACHE-2.0` at that revision are retained
under `packaging/licenses/plugin-dialog-2.8.1-LICENSE_*`. Both original files
lack a final newline; their bytes, copyright notices and terms remain unchanged.
Reviewed source URLs, registry integrity, manifest/SPDX identities and both
notice hashes are in `packaging/licenses/reviewed-frontend-notices.json`.
Only licensed notice text was copied, not implementation; no dependency was added.

Frontend notice preparation preserves Angular's generated file as an unchanged
prefix, then appends these labeled upstream terms. The exception fails closed
for changed package identity, lock integrity, source hashes, unpinned URLs,
newly published notice files or missing dual-license terms. It is not a generic
template fallback or overall distribution approval.

## Exact upstream notice for the published tauri-specta crate

The `tauri-specta 2.0.0-rc.21` registry package declares MIT but does not ship
a license/notice file. Its `.cargo_vcs_info.json` identifies upstream revision
`5cd56fe8a8d681ba5b649dc7fd4e2e2b001e4e57` in the canonical manifest repository
<https://github.com/oscartbeaumont/tauri-specta>.

The upstream `LICENSE` at that revision is MIT, copyright 2022 Oscar Beaumont:
<https://github.com/oscartbeaumont/tauri-specta/blob/5cd56fe8a8d681ba5b649dc7fd4e2e2b001e4e57/LICENSE>.
Its Git blob is `6d135f35f014e78278507b868d6617018e16b488`.

The complete unmodified license is retained as
`packaging/licenses/tauri-specta-2.0.0-rc.21-LICENSE`. No implementation source
was copied and no dependency was added. A notice collector must bind any
exception to this exact package/version, license declaration and reviewed
source/hash; missing terms must not silently receive a generic MIT template.

## Additional retained upstream workspace notices

`packaging/licenses/reviewed-rust-notices.json` is the authoritative index of
reviewed package/version, registry, declared repository/license, published VCS
revision/path, canonical upstream file URL and both file hashes. Fourteen
package exceptions are now retained, including the tauri-specta exception above.
The added verbatim notices cover Specta, dlopen2, defmt, alloc-stdlib, Inflector,
tauri-plugin and libappindicator-sys. No dependency or implementation source was
added. Copyright holders and all upstream terms remain unmodified.

- MIT/Apache dual-license workspace files are both retained, not replaced with
  a generic license template or an implicit newly selected option.
- The Tauri workspace SPDX notice declares CC0-1.0 for that notice data and is
  also preserved. It does not establish an SBOM for this application's binary.
- The libappindicator registry metadata omits its repository. Read-only exact
  commit search found one upstream match, `tauri-apps/libappindicator-rs` at
  `eafd1e3682a1247f595410266091e9684021cb6f`; `sys/Cargo.toml` there confirms
  `libappindicator-sys 0.9.0` and the declared dual license. The missing metadata
  remains null in the exception; the reviewed upstream repository is explicit.
- Old Inflector VCS metadata omits `path_in_vcs`. Absence can match only a
  reviewed root path, not an inferred subdirectory.
- Git-blob and SHA-256 checks verify the copied bytes, including two upstream
  files without final newlines. The narrow `.gitattributes` rule preserves
  retained `*LICENSE*` files; project source and policy JSON remain subject to
  ordinary whitespace checks.

Exact source URLs and hashes are in the reviewed index; unknown or changed
provenance must still fail collection. These exceptions do not approve complete
redistribution compliance.

## Project-authored selectors source-availability notice

The published `selectors 0.38.0` crate declares MPL-2.0 and carries its license
headers in source files but omits a standalone license document. The recorded
Stylo revision is `572ecba2d1600e7c3d490586692a209faf703baa`, path `selectors`.
The reviewed `lib.rs` Git blob is
`e60fe5be257f03091569b56a149e7c95ab186bfb`, also matching the published source.

`packaging/licenses/selectors-0.38.0-SOURCE-NOTICE.txt` is original project text
identifying the exact public source archive and Mozilla's license terms. It is
not represented as an upstream license file or as copied third-party terms.
The explicit `mpl-source-availability` policy verifies its hash, source/header
evidence and retrieval locations. Source implementation text is not emitted in
the catalog. This addresses notice generation only; packaging integration and
the full distribution/source obligations remain separately subject to review.

## JavaScript security maintenance (2026-10-24)

Angular framework packages are pinned to 22.2.3, Angular CLI/build tooling to
22.2.4, and Vitest requires at least 4.1.12. The workspace overrides temporarily
replace vulnerable exact transitive pins with patched releases in the same major
line: axios 1.20.0, brace-expansion 5.0.12, fast-uri 3.1.9,
follow-redirects 1.16.1, smol-toml 1.9.0, Vite 8.3.3, and Zod 4.6.6.
Remove overrides as the owning upstream packages adopt patched versions.

Canonical repositories and license identifiers were verified in the installed
published package manifests: angular/angular, angular/angular-cli,
vitest-dev/vitest, axios/axios, juliangruber/brace-expansion,
fastify/fast-uri, follow-redirects/follow-redirects, squirrelchat/smol-toml,
vitejs/vite, and colinhacks/zod. These packages declare MIT, except fast-uri
and smol-toml, which declare BSD-3-Clause. Existing upstream license files remain
in the unmodified packages; no implementation source was copied into this repo.

Angular CLI also updates its development-only MCP server/core dependencies to
2.3.1 from modelcontextprotocol/typescript-sdk. Their metadata declares
Apache-2.0; the published LICENSE explains the transition from MIT and retains
MIT terms for contributions not relicensed. Preserve that complete upstream
LICENSE when redistributing these tools. They are build/development tools, not
application runtime dependencies. No MCP SDK source is copied or adapted.

`pnpm nx run desktop:audit` performs a fresh, uncached registry audit of both
runtime and development dependencies, failing for any reported severity.
An audit result is time-specific and does not prove application reachability
or the absence of unknown vulnerabilities. Package build and behavioral
acceptance remain separate gates.

## Directory-relative LFS cleanup

Dependency: `rustix 1.1.5`, already present transitively in Cargo.lock and now
also used directly by git-core on Unix with its `fs` feature.

Source: <https://github.com/bytecodealliance/rustix>

License: `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`, verified in the
locally cached 1.1.5 manifest and upstream COPYRIGHT/LICENSE-MIT files. The MIT
option is selected and is compatible with this project's GPL-3.0-only license.
The contributor notice and MIT terms are retained in THIRD_PARTY_NOTICES.md.
Compatibility reference: <https://www.gnu.org/licenses/license-list.html#Expat>.

Usage: safe wrappers for opening directory handles, checking relative file
metadata without following links, and unlinking reviewed LFS cache entries
relative to a retained directory handle. Implementation is independently written
against the documented public API; no rustix implementation code is copied.

## Cached Git attribute resolution

The existing `gix 0.90.0` dependency enables its `attributes` and `sha256` features
for typed, cached worktree/index attribute matching in both repository formats.
Attribute values remain distinct from
the set/unset states, including drivers literally named `set` or `unset`.

The feature adds these locked transitive packages:

- `gix-submodule 0.36.1`: MIT OR Apache-2.0,
  <https://github.com/GitoxideLabs/gitoxide>
- `dashmap 6.2.1`: MIT, <https://github.com/xacrimon/dashmap>
- `hashbrown 0.14.5`: MIT OR Apache-2.0, <https://github.com/rust-lang/hashbrown>
- SHA-256 support: `sha2 0.11.1`, `digest 0.11.3`, `crypto-common 0.2.2`,
  `block-buffer 0.12.1`, `cpufeatures 0.3.1`, and `hybrid-array 0.4.15`, all
  MIT OR Apache-2.0, from the RustCrypto `hashes`, `traits`, `utils`, and
  `hybrid-array` repositories linked in the third-party notices.

Licenses and repository provenance were checked in the published crate
manifests and license files. These permissive licenses are compatible with the
project's GPL-3.0 license. They are used unmodified; the MIT copyright/permission
notices are retained in `THIRD_PARTY_NOTICES.md`, included in the Debian package.
No gitoxide implementation source was copied or adapted.

## Specta and Tauri Specta

Sources:

- <https://github.com/specta-rs/tauri-specta/tree/v2.0.0-rc.21>
- <https://github.com/specta-rs/specta>

Pinned crates and licenses:

- `tauri-specta 2.0.0-rc.21`: MIT
- `specta 2.0.0-rc.22`: MIT
- `specta-typescript 0.0.9`: MIT

The license identifiers and canonical repositories were verified in the
published crate metadata. These unmodified build dependencies derive Tauri
command, payload, and event types and emit the checked-in TypeScript boundary.
`tools/generate-ipc.mjs` is original project code that adapts generated command
methods to named-argument functions without parsing Rust or duplicating its
signatures. No upstream source was copied or adapted.

## Tauri Driver

Source: <https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-driver>

Version: `2.0.6`, pinned for native CI.

License: Apache-2.0 OR MIT.

Usage: development-only intermediary between the original Python WebDriver
client and the platform `WebKitWebDriver`. It is installed from its published
crate in CI and is not embedded in the desktop package. No source code copied
or adapted.

## Nx agent skills and Codex integration

Sources:

- <https://github.com/nrwl/nx-ai-agents-config/tree/525ce266e2>
- Nx 23.2.1 package, `dist/src/ai/set-up-ai-agents/get-agent-rules.js`
  (<https://github.com/nrwl/nx>, MIT).

License: MIT, verified against the cached upstream snapshot's `LICENSE`.
The copyright and full permission notice are retained in
`THIRD_PARTY_NOTICES.md` under "Nx agent tooling".

Copied development-only skills from the snapshot's `generated/.agents/skills`:

- `link-workspace-packages`, `monitor-ci`
- `nx-cloud-api`, `nx-cloud-cache-investigator`, `nx-cloud-ci-failure-review`
- `nx-generate`, `nx-import`, `nx-plugins`, `nx-run-tasks`, `nx-workspace`

The copied files include the skills' references and CI-monitor scripts.
`.codex/agents/ci-monitor-subagent.toml` comes from `generated/.codex/agents`;
`.codex/config.toml` is adapted from the generated Codex configuration.
The Nx section in `AGENTS.md` comes from the installed Nx generator.

Local adaptations:

- Use `pnpm exec nx mcp` for the workspace's installed Nx version.
- Identify the CI-monitor role as optional; Nx Cloud is not enabled by this
  configuration and must be connected separately to use Cloud-specific skills.
- Require user authorization for CI/Git mutations, preserve existing scoped
  authorization, and remove automatic empty-commit and known-failing-push fallbacks.
- Make the `AGENTS.md` MCP guidance conditional on server availability and tidy
  its generated section spacing.

The remaining copied skill files and decision scripts are unmodified. They are
development tooling and are not embedded in the desktop executable.

## serde_json

Source: <https://github.com/serde-rs/json>

License: MIT OR Apache-2.0, verified in the canonical Cargo.toml.

Usage: bounded JSON records for durable per-worktree operation recovery and
test-only verification of the flattened desktop IPC response. Used
unmodified as a dependency; no source code copied or adapted. The licenses are
compatible with this GPL-3.0 project. Redistributed dependency packages must retain
the selected upstream license and applicable notices.

## getrandom

Source: <https://github.com/rust-random/getrandom>

License: MIT OR Apache-2.0 (verified in upstream v0.3.4 package metadata).

Usage: OS-backed random operation capability tokens for the askpass IPC bridge.
Used as an unmodified dependency, already present transitively in the workspace.
No source code was copied or adapted. Upstream dependency license files remain
applicable on redistribution; licenses are compatible with this GPL-3.0 project.

## libc (Unix terminal I/O)

Source: <https://github.com/rust-lang/libc>

Version: 0.2.190, already present transitively in the workspace lockfile.

License: MIT OR Apache-2.0; the MIT option is used and is compatible with
this project's GPL-3.0-only license.

Usage:

- Direct Unix-only dependency for `fcntl` and `poll` in cancellable PTY I/O.
- The crate is used unmodified. No upstream implementation code is copied
  or adapted; the terminal stream and cancellation logic are project code.

Required notices:

- The upstream copyright and MIT permission notice are retained in
  `THIRD_PARTY_NOTICES.md` for binary redistribution.

## Renderer-test Node type declarations

Sources:

- `@types/node 24.19.2`: <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node>
- `undici-types 7.24.6`: <https://github.com/nodejs/undici>

License: MIT for both packages, verified in the published package metadata and
installed `LICENSE` files. This permissive license is compatible with GPL-3.0.

Usage:

- Development-only ambient declarations for strict checking of Playwright test
  helpers against the supported Node 24 toolchain. The workspace previously had
  optional peer references but no installed Node declarations.
- These packages supply types, not a browser Node polyfill or runtime Undici
  client. Application compilation retains its explicit empty `types` list.
- No implementation source was copied or adapted. Retain their packaged MIT
  notices whenever redistributing the declaration packages; they are not added
  to the desktop application's runtime payload.

## Playwright Test

Source: <https://github.com/microsoft/playwright>

License: Apache-2.0

Usage:

- Development-only browser automation for Git Khronos renderer tests.
- No Playwright source code is copied or adapted into this repository.

Required notices:

- Playwright and its browser downloads retain their upstream license and notice
  files in their distributed packages.

## notify

Source: <https://github.com/notify-rs/notify>

License: CC0-1.0

Usage:

- Cross-platform filesystem notifications for Git metadata directories.
- Git Khronos supplies its own event coalescing and repository refresh logic.
- No notify source code is copied or adapted into this repository.

Required notices:

- None required by CC0-1.0; provenance is retained here for transparency.

## Tokio

Source: <https://github.com/tokio-rs/tokio>

License: MIT, verified against the downloaded `tokio 1.53.3` crate's `LICENSE`.

Usage:

- Unmodified transitive asynchronous runtime dependency of Tauri.
- The lockfile selects 1.53.3, which contains the upstream remediation for
  [RUSTSEC-2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386.html).
  This is dependency maintenance, not evidence of an exploitable application bug:
  the reviewed Linux feature tree enables `fs`, `io-util`, `rt-multi-thread`,
  and `sync`, but not `net`, which gates `AsyncFd`; application sources contain
  no direct `AsyncFd` calls. Other targets and future feature changes need review.
- Version 1.54.0 is deliberately not selected; its separate interval race is
  documented in
  [RUSTSEC-2026-0384](https://rustsec.org/advisories/RUSTSEC-2026-0384.html).
- No Tokio implementation source is copied or adapted into this repository.

Required notices:

- The upstream copyright and MIT permission notice are retained in
  `THIRD_PARTY_NOTICES.md` for binary redistribution.

## aho-corasick

Source: <https://github.com/BurntSushi/aho-corasick>

License: Unlicense OR MIT (MIT option selected).

Usage:

- Direct dependency version 1.1.5, already present transitively in the lockfile.
- Public DFA API for bounded, incremental Git transport diagnostic matching.
  Transport stderr is fully drained but only its first 64 KiB is retained;
  error classification scans the entire stream without buffering whole lines.
- Published package metadata and `LICENSE-MIT` were inspected locally. No
  implementation source is copied or adapted into this repository.
- On 2026-10-24 the new integration passed 526 core tests (including nine new
  stderr regressions), followed by the complete ten-target source gate with
  strict Clippy and dedicated LFS/SSH/signing tests. The preserved pre-fix test
  reproduced excessive retention before the new implementation passed. Evidence:
  `target/validation-runs/transport-stderr-red/`,
  `target/validation-runs/transport-stderr-green-api-retry/`, and
  `target/validation-runs/transport-stderr-source-gates/`.
- A fresh Debian candidate with SHA-256
  `97952c3641bd6152eb61933982e464b666947550d8827c736fe852365327cb57`
  subsequently passed all 280 extracted-package native scenarios. Evidence is
  retained under `target/validation-runs/transport-stderr-native-evidence/`.
  System installation and migration are separate acceptance scopes. Adding a
  notice is not itself validation evidence.

Required notices:

- The upstream copyright and full MIT permission notice are retained in
  `THIRD_PARTY_NOTICES.md` for binary redistribution.

## gitoxide (`gix`)

Source: <https://github.com/GitoxideLabs/gitoxide>

License: MIT OR Apache-2.0

Usage:

- In-process object and reference access for incremental commit history
  paging, avoiding one Git process per page in very large repositories.
- Git Khronos supplies its own date-ordered walk and output formatting,
  verified against `git log` output; reference tips and decorations still come
  from the Git CLI.
- No gitoxide source code is copied or adapted into this repository.

Security review (2026-10-24):

- The previous locked 0.88.0 version is in the affected range of
  [GHSA-q54r-jf2p-rfr2](https://github.com/GitoxideLabs/gitoxide/security/advisories/GHSA-q54r-jf2p-rfr2).
  The lockfile now selects upstream's patched 0.90.0 release. Workspace tests,
  build checks, and strict Clippy passed on 2026-10-24. The fresh candidate
  `97952c3641bd6152eb61933982e464b666947550d8827c736fe852365327cb57`
  also passed all 280 extracted-package native scenarios; this is distinct from
  system installation or migration acceptance. The equivalent performance bundle is now
  named `max-performance` rather than `max-performance-safe`; default features
  remain disabled. Do not treat an unrelated JavaScript audit as clearance of
  Rust dependencies.
- `tests/gix_trust_policy.rs` independently tests reduced-trust repository-local
  protection settings through the public API, with ordinary-tree and explicitly
  trusted controls. It builds an index in memory, never checking out a crafted
  path. It passes with 0.90.0 and fails at the intended untrusted-alias assertion
  with 0.88.0 in an isolated scratch project using the same test source. The
  baseline run never changes the application's manifest or lockfile. Local
  evidence: `target/validation-runs/rust-security-source-validation/` and
  `target/validation-runs/gix-trust-policy-red-run/`.
- The reviewed application call sites use object reads/hashing and
  `attributes_only` with an independently constructed in-memory attribute index.
  No application call to gitoxide checkout, merge, tree editing, or repository
  index creation was found. Mutating Git operations use the Git CLI. This narrows
  the observed exposure but is not a general security guarantee or a substitute
  for updating the affected dependency.

Transitive licenses outside MIT/Apache-2.0:

- `zlib-rs`, `foldhash`: Zlib (`tinyvec`: Zlib OR Apache-2.0 OR MIT).
- `uluru`: MPL-2.0, used unmodified as a library dependency.
- `unicode-ident`: (MIT OR Apache-2.0) AND Unicode-3.0.

Required notices:

- Binary distributions must retain the MIT/Apache-2.0, Zlib, MPL-2.0, and
  Unicode-3.0 license texts of these crates; MPL-2.0 additionally requires
  informing recipients where the `uluru` source is available
  (<https://github.com/servo/uluru>).

## Optional external command-line tools (no code bundled)

The workspace collaboration and agent features can invoke separately installed
programs. No source, binaries, libraries, icons or other assets from these tools
are copied, linked or redistributed with Khronos. Their executable names are
used for normal documented process invocation. Model/service access and
provider accounts remain subject to the user's separate installation and terms.

Upstream provenance checked on 2026-10-31:

| Program | Canonical project / license reference | Upstream license or terms |
| --- | --- | --- |
| `gh` | https://github.com/cli/cli/blob/trunk/LICENSE | MIT |
| `codex` | https://github.com/openai/codex/blob/main/LICENSE | Apache-2.0 |
| `gemini` | https://github.com/google-gemini/gemini-cli/blob/main/LICENSE | Apache-2.0 |
| `opencode` | https://github.com/anomalyco/opencode/blob/dev/LICENSE | MIT |
| `claude` | https://github.com/anthropics/claude-code/blob/main/LICENSE.md | Proprietary; upstream refers to Anthropic Commercial Terms |

This integration introduces no additional bundled code or dependency notice
payload. Any future bundling or adaptation requires a separate license and
redistribution review; this external-process integration is not permission to
copy tool implementations. The Khronos repository license remains GPL-3.0.


## Image metadata and bounded raster transport

- `imagesize` 0.15.0: https://github.com/Roughsketch/imagesize
  (published VCS revision `7dba0c7ae38ee1b90024f82cbb8fab12d6b1b4eb`).
  License: MIT, Copyright (c) 2017 Maiddog. Its published `LICENSE` and manifest
  were reviewed. Only BMP/GIF/ICO/JPEG/PNG/WebP metadata features are enabled;
  it has no runtime dependencies. Cargo.lock pins the registry checksum.
- `base64` 0.22.1: https://github.com/marshallpierce/rust-base64.
  License: MIT OR Apache-2.0. This was already a locked transitive dependency;
  it is now a pinned direct dependency for selected raster response encoding.

Both are compatible with the repository's GPL-3.0-only license. The existing
Rust notice collector must retain their published license files in distributable
notices. Neither implementation was copied into project source. The project
independently implements comparison selection, classification policy and UI.
Header dimensions are metadata, not proof that a complete image decodes. Actual
browser decode outcomes and dimensions remain separate acceptance checks.


## url 2.5.8 direct dependency for independent repository links

Source: https://github.com/servo/rust-url
Published package: https://docs.rs/crate/url/2.5.8
License: MIT OR Apache-2.0, verified against the cached published manifest and both license files.
The crate was already present transitively in the lockfile; the core now pins its direct use.
Usage: public URL parsing/serialization API only. No library implementation was copied or adapted.
Redistribution: retain the published license notices through the existing Rust notice collector.
No additional copyleft/source-distribution requirement is introduced by this dependency.


## encoding_rs 0.8.42 direct dependency for working-file text

Source: https://github.com/hsivonen/encoding_rs
Published crate: https://docs.rs/crate/encoding_rs/0.8.42
License: (Apache-2.0 OR MIT) AND BSD-3-Clause, verified from the exact cached
published manifest, COPYRIGHT, LICENSE-APACHE, LICENSE-MIT and LICENSE-WHATWG.
The WHATWG-derived data requires its BSD notice in addition to the chosen library
license. All four complete files are already retained by the Linux Rust notice
collector; their content hashes matched the canonical published crate files.
The version was already transitively locked; direct use introduces no new package.
Usage: public Windows-1252 codec API only, with replacement refused. No library
implementation or tables were copied. UTF-8/UTF-16 handling uses Rust standard
APIs and original validation. The original encoded bytes must round-trip exactly.

## Native editor identifiers

The native editor directly uses the public `getrandom` 0.3.4 API, already locked
by the workspace, to create ephemeral opaque identifiers. Canonical source:
https://github.com/rust-random/getrandom. License: MIT OR Apache-2.0. Both full
license files were compared with the existing Linux notice catalog. No source
was copied and no additional package was introduced by this direct relation.

## Bounded Markdown interpretation

Dependency: `marked` 18.1.2, pinned through pnpm.
Source: https://github.com/markedjs/marked
Public API: https://marked.js.org/using_pro#lexer
License metadata: MIT. The package's complete `LICENSE` also contains the
Markdown BSD-style notice; preserve the complete file in binary attribution.
The full installed notice was reviewed against https://marked.js.org/license.
Only the public lexer is consumed; no parser source or renderer was copied.
An original bounded tree and Angular text interpolation render inert content.
No external asset is embedded or fetched. The lexer runs in a terminable worker.
The upstream advisory GHSA-6v9c-7cg6-27q7 identifies 18.0.0/18.0.1 as affected
and 18.0.2 as patched; the selected 18.1.2 is newer. This is not a claim that
all inputs or future advisories are covered. Distribution notice inclusion
remains an exact-package acceptance requirement.

## Tauri desktop link transport plugins

Canonical source: https://github.com/tauri-apps/plugins-workspace
Published crates: `tauri-plugin-deep-link` 2.6.3 and
`tauri-plugin-single-instance` 2.5.5 (desktop only, deep-link feature enabled).
Both declare MIT OR Apache-2.0; the published manifests and complete MIT and
Apache-2.0 files were checked. Their permissive options are compatible with this
repository's GPL-3.0 license. No plugin implementation was copied or adapted.
Usage is through public Rust SDK APIs and static scheme configuration only.

The lockfile introduces 44 transitive/direct packages. Canonical manifests declare
MIT, MIT OR Apache-2.0, Apache-2.0 OR MIT, or CC0-1.0; no unknown license was accepted.
The Linux notice audit covers 41 active added packages and the existing collector
retains complete license files/notices in distributable package assets. The three
non-Linux packages were separately checked against their published manifests.
Generated Tauri ACL/schema files are build output from these pinned dependencies;
they are not manually transcribed third-party source. License and copyright notices
remain in package dependency notices. No proprietary material was introduced.
