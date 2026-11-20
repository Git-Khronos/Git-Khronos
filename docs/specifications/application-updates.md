# Application updates

Status: requested capability; implementation and package qualification pending.
This document does not assert that the application can currently self-update.

## User-facing requirements

- Provide an application-level **Updates** menu entry with a manual check and
  explicit download/install controls. It must work without an open repository.
- Provide an **Enable automatic updates** setting, disabled by default. Turning
  it off must not remove manual checks or install an already downloaded update.
- Automatic mode may check/download/verify in the background and install only at
  an explicitly safe application lifecycle boundary. It must not interrupt Git
  operations, terminal work, or unsaved editor intent. Restart requirements and
  any OS authorization must be disclosed before enabling it.
- Show installed/available versions, progress, no-update results, retryable
  failures and restart-needed state. Never report successful installation from
  a successful download alone. Do not replay an uncertain installer invocation.

## Trust and native authority

- Use signed packages verified against an application-pinned publisher key.
  Missing publisher configuration must make installation unavailable with a
  clear explanation, never accept the server's own key as trust establishment.
- Production checks/downloads use the configured official HTTPS source. Test
  endpoints and ephemeral keys must be isolated from distributable release trust.
- Require a signature-bound artifact version and reject a manifest/version
  mismatch or downgrade. A valid old package signature alone is not proof that
  it is the newly announced version.
- Private signing keys must not enter source control or frontend configuration.
  Publishing signed assets and managing release secrets are separate release
  operations; implementing this feature does not authorize a release.
- Native state owns the offered update, verified bytes, install intent and actual
  installer outcome. The renderer cannot submit arbitrary package URLs or paths
  as an installation capability. Manual/automatic modes share these gates.
- Debian/RPM installation must preserve package-manager ownership and use OS
  authorization. The application must not collect administrator passwords or
  silently try another privilege mechanism after authorization is cancelled.

## Verification requirements

Exercise manual and automatic modes, opt-out during pending work, malformed or
missing manifests, same/older versions, failed downloads, invalid signatures,
wrong package formats, concurrent Git/terminal work, stale UI completion,
installation refusal/uncertainty and restart handling. Retain actual package
hashes and distinguish installed-host testing from extracted-package fixtures.
Do not run a privileged installer or modify the developer's installed app merely
to test the updater; use explicit owned fixture adapters for unsafe boundaries.

## Implementation research

The current Tauri updater candidate supports signed update verification and
Debian/RPM formats in addition to AppImage/macOS/Windows. Its default Linux
privilege fallbacks need review against the no-password-collection requirement.
The verified upstream candidate is `tauri-plugin-updater` 2.14.1. It provides
cached-byte verification and a `requireSignedVersion` policy. The installed
workspace Tauri CLI 2.12.1 supports `signer sign --app-version` for version-bound
signatures; this was checked locally with `--help`, not inferred from old docs.
The `cargo tauri` subcommand is not installed here; use the workspace's
`pnpm exec tauri` CLI. No updater dependency has been added and no release trust
key configured yet.
See [sources](../provenance/sources.md) for primary references. Implementation
must remain independently designed; upstream code is not an implementation
transcription specification.
