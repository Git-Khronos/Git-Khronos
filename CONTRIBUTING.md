# Contributing to Git Khronos

Thank you for helping build a Git client that stays free, local-first, and
pleasant to use.

## Before opening a change

1. Discuss large features or architectural changes in an issue first.
2. Keep changes focused and preserve the Rust boundary around filesystem and
   Git process access.
3. Never add telemetry, mandatory accounts, paid feature gates, or shell-based
   Git command construction.
4. Add tests for Git parsing and state-changing behavior.

## Local checks

```bash
pnpm install
pnpm check
pnpm test
```

`pnpm check` includes Rust formatting. Run `cargo fmt --all` to fix
formatting before rerunning the checks.

On Debian or Ubuntu, changes that affect the packaged application should
also build the real installer and run the relevant native acceptance suite.
For example:

```bash
pnpm nx run desktop:package-deb
pnpm nx run desktop:native-smoke
```

Native smoke extracts the package into an isolated fixture and does not
install it on your host. To check an archived candidate instead of the
default local build, use `pnpm nx run desktop:native-smoke -- --package /path/to/candidate.deb`.
If you build with `CARGO_TARGET_DIR`, set the same variable for native smoke
to select that build without an explicit package argument.
For a narrower or installed test, see
[Linux packaged acceptance](docs/linux-acceptance.md).

For fast feedback without rebuilding an installer, run the daily-driver
renderer smoke selection:

```bash
pnpm nx run desktop:e2e -- --project=chromium --grep '@daily-driver-smoke'
```

To run the same smoke suite in WebKit, prepare Playwright's WebKit browser
once with `pnpm exec playwright install webkit`, then run:

```sh
pnpm nx run desktop:e2e-webkit -- --grep '@daily-driver-smoke'
```

This target checks for the browser and probes headless startup before starting Angular. Set
`PLAYWRIGHT_BROWSERS_PATH` for both commands when using a custom browser cache.


It covers startup, occupied branches, working-tree scroll and discard,
stash review, GitLab catalogue navigation, and update consent. It does
not replace the full renderer suite or native/package qualification.

Use a focused browser spec for renderer-only iteration before rebuilding a
package. The Ubuntu 22.04 theme-cleanup build spent about six minutes
compiling optimized Rust and under 20 seconds building the renderer.
New native reports record elapsed time and phase totals; the installed
acceptance summary shows the three slowest phases without using timings
as pass/fail evidence.

Publisher-enabled Jammy qualification runs the environment suite in parallel
with smoke, GitLab, watcher and LFS checks. Both jobs install and check the
same build artifact, and both must pass. The local theme-cleanup run measured
655 seconds for the environment suite and 307 seconds for the other Jammy
suites. Splitting them removes that serial wait from the test plan; hosted
setup and queue time still affect the actual release duration.

Use conventional, imperative commit subjects and include a Developer
Certificate of Origin sign-off (`git commit -s`). By contributing, you certify
that you have the right to submit the work under GPL-3.0-only.

## Debian release handoff

An offline test-key package can demonstrate compatibility but is not the
package to publish. Keep its checksum, build receipt, and acceptance reports
with the local evidence.

1. On the canonical repository, select an existing stable version tag on
   `main` and run **Qualify Debian release candidate** from `main`. That
   workflow builds with the configured publisher public key and tests the
   exact artifact it produces.
2. After qualification succeeds, sign that exact Debian artifact offline
   with the matching publisher key. Keep the private key and its passphrase
   out of GitHub Actions and the repository.
3. **Publish signed Debian release** accepts the stable tag, successful
   candidate run ID, and public signature. Its verify job checks the
   candidate and the final assets. Only the separately enabled, protected
   `signed-release` job publishes.

Do not substitute a local test-key artifact or reuse evidence from another
package checksum. See [Linux packaged acceptance](docs/linux-acceptance.md)
for the offline verifier and evidence format.

## Product principles

- Git remains the behavioral source of truth.
- Destructive actions explain scope and recoverability before execution.
- Display paths are never treated as executable arguments without validation.
- The application must remain useful without a network connection.
- Accessibility and keyboard operation are feature requirements.
