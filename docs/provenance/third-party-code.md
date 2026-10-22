# Third-party code and development tools

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

Transitive licenses outside MIT/Apache-2.0:

- `zlib-rs`, `foldhash`: Zlib (`tinyvec`: Zlib OR Apache-2.0 OR MIT).
- `uluru`: MPL-2.0, used unmodified as a library dependency.
- `unicode-ident`: (MIT OR Apache-2.0) AND Unicode-3.0.

Required notices:

- Binary distributions must retain the MIT/Apache-2.0, Zlib, MPL-2.0, and
  Unicode-3.0 license texts of these crates; MPL-2.0 additionally requires
  informing recipients where the `uluru` source is available
  (<https://github.com/servo/uluru>).
