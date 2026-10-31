# Third-party code and development tools

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
