# Application updates

Status: the manual and opt-in controls are implemented. Local publisher-key
builds and signed test assets exist; the public update feed and end-to-end
privileged installation are not yet qualified.

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
`pnpm exec tauri` CLI. The desktop manifest now pins updater 2.14.1 with the
existing native-TLS stack, without granting guest JavaScript updater permissions.
The initial desktop `cargo check` passed. Cargo added six packages without
upgrading or removing existing locked packages; their canonical repositories and
MIT/Apache-2.0-compatible license expressions were verified from Cargo metadata
and retained at `target/local-review/updater/new-dependency-provenance.json`.
The native runtime, typed commands/events and deferred Updates dialog are now wired.
Later checkpoints below cover packaged runtime qualification.
See [sources](../provenance/sources.md) for primary references. Implementation
must remain independently designed; upstream code is not an implementation
transcription specification.

## Native policy implementation checkpoint

`application_update_model.rs` now owns the runtime policy, separately from the
native transport/installer and the renderer. Application-level Updates entries
are present in the main menu and welcome launcher. Manual checks and explicit
download/verify/install do not require automatic consent. The native preference
is opt-in, persisted atomically, and never duplicated in renderer local storage.
The background scheduler checks every six hours after opt-in; installation
requires a current automatic-origin lease and an idle native activity snapshot.
Linux package installation does not forcibly exit this window. Windows checks
and signature verification are wired, but self-installation is deliberately
unavailable until a safe restart boundary is implemented. That platform work
remains part of the requested capability, not a completed substitute.

Current source validation includes policy, real signature/version-binding,
bounded owned-loopback response consumption, real signed inert Debian metadata,
and receipt-admission fault tests. Public fixtures are independently generated
under `application_updates/fixtures`; no private key is committed and no test
invokes a privileged installer. Renderer coverage exercises manual flow with
automatic mode off, confirmed preference state after refusal/lost reply, absent
trust, one-shot install and stale dialog control retirement. These results are
not packaged updater, privileged-installer, Windows or macOS acceptance.

The production builder uses a compile-time
`GIT_KHRONOS_UPDATER_PUBLIC_KEY` (public verification key, never a private key).
Without this key the UI clearly reports unconfigured trust and cannot check,
install or enable automatic updates. The release publisher must separately
configure this key, sign artifacts with version-bound signatures and publish
`latest.json` at the approved official release endpoint. An encrypted publisher
key has been generated locally, but neither the key nor the manifest is
provisioned in the public release workflow. Debian Task build
receipts now bind the public-key fingerprint as well as source/output hashes,
so enabling, rotating or removing trust cannot reuse an older compiled binary.


The OS adapter must persist a prepared receipt before accepting it and invoking
an installer, then recheck its still-current offer and native-idle state.
An uncertain receipt blocks replay across restart. Disabling automatic mode
immediately revokes future automatic intent even if saving preferences fails;
it never discards an already accepted install's actual outcome. Enabling requires
confirmed preference persistence. Rename/flush uncertainty is reported rather
than represented as proof that no preference write occurred.

## Exact-artifact checkpoint and remaining qualification

The first local unconfigured-key Debian candidate passed 44 focused native and
272 full environment scenarios (the latter includes the former). Its SHA-256 is
`f44a6066d6e47062e1ec36193f88a7876233e6d3da4ffa8f8306f2f63847ff67`.
This proves the missing-trust UI/backend refusal path and existing native
workflows for that artifact, not a privileged updater installation or other
platforms. A Python-only pre-click readiness correction was required; the first
failed report is retained separately. No click or uncertain write was replayed.

Subsequent source refinements address compact layout/menu regressions,
indeterminate progress, no-repository entry coverage, bounded inspector process
groups, Debian authorization refusal and installer-worker failure. They require
a newly built/qualified artifact; the earlier artifact's result must not be
presented as qualification of these later source edits. Publisher trust/release
configuration, Windows safe self-installation and other platform acceptance
remain pending.

Restart reconciliation also requires native package-database proof for Debian
and RPM. A running binary cannot substitute for missing or unconfigured package
state. Pending receipts are inspected off-thread on startup; confirmed retirement
while already running that version resumes checks without a second restart.
Unconfirmed persistence continues to block replay. Tests reproduced both the
missing-database fallback and second-restart problem before fixing them.
Cross-installation receipt ownership (multiple executable/bundle paths or package
formats), positive controller-level signed-fixture integration, publisher tooling
and remaining platform installation/restart acceptance still need qualification;
fixture crypto/policy tests alone are not that proof.

The rebuilt Debian checkpoint containing the restart reconciliation passed all
272 extracted-package native environment scenarios. Debian SHA-256:
`476ff5a913b25079c7d21e5e7b0bfd7b6bb8f5388004b7dbfe23012227f7dc76`.
This also rechecks the packaged menu and native fail-closed behavior without a
publisher key. It does not qualify a live signed download or privileged install.

## Preparing signed Debian release assets locally

A release-key custodian should keep the encrypted private key and its passphrase
outside Git and arrange separately protected recovery copies before distributing
builds that pin the public key. Never commit the private key, pass it on a command
line, or put it in the build environment. Set `GIT_KHRONOS_UPDATER_PUBLIC_KEY`
from the public key when building; the Debian build receipt binds that value to
the resulting package. Check the release version, pinned key, and exact-artifact
qualification before signing. Provide the passphrase through the signer's
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` environment only for the signing process.

For the Ubuntu release artifact, run `pnpm nx run desktop:package-ubuntu`
on Ubuntu 22.04 amd64. The task records the completed build receipt at
`release/.git-khronos-package-build.v1.json` under the selected Cargo target
directory only after the package and its Jammy ABI have been checked. A generic
local Debian build is useful for testing but is not a substitute for this
release build.

Retain the package build receipt and the completed native environment report
alongside the exact package. For a publisher-key-enabled Debian build, the
report must include the configured-trust scenario
(`GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST=1` selects its expected outcome).
Before preparing assets for publication, run the strict preflight. It also
requires the Jammy build profile and repeats the release ABI check on a private
snapshot of the exact package:

```sh
QUALIFIED_PACKAGE_SHA256=$(node tools/check-debian-update-evidence.mjs \
  --release-package "$PACKAGE" "$BUILD_RECEIPT" "$NATIVE_REPORT" "$PUBLIC_KEY_FILE") || exit 1
```

These are operator-owned local records, not signed provenance attestations.
For a local test build only, omit `--release-package` to check the matching
build and runtime evidence without asserting the Ubuntu ABI. The release stager
separately verifies the actual package bytes.

With `PACKAGE` (absolute path), `VERSION`, `PRIVATE_KEY_FILE`, `PUBLIC_KEY_FILE`,
`STAGING_PARENT` (existing directory), and `QUALIFIED_PACKAGE_SHA256` set:

```sh
printf '%s  %s\n' "$QUALIFIED_PACKAGE_SHA256" "$PACKAGE" | sha256sum --check --strict || exit 1
pnpm exec tauri signer sign --private-key-path "$PRIVATE_KEY_FILE" \
  --app-version "$VERSION" "$PACKAGE" || exit 1
cargo run --locked -p git-khronos-desktop --example stage-debian-update -- \
  "$PACKAGE" "$PACKAGE.sig" "$PUBLIC_KEY_FILE" "$STAGING_PARENT" \
  "$QUALIFIED_PACKAGE_SHA256"
```

The stager prints a new directory containing the verified package, a
`latest.json` manifest, and `update-assets.sha256`. It streams the signed bytes
into owned staging, checks the exact qualified digest, and rejects mismatched
package metadata, architecture, and signed version. No signing secret is needed
for staging. Publication is a separate operation: the matching release tag and
asset name must agree with the staged URL. The current release workflow does not
publish these assets automatically.

Installations built without the public key need a one-time manual upgrade to a
trusted build. They cannot use a release manifest to establish trust in its own
signer. Automatic updates remain off until the user opts in.

A local publisher-key-enabled Debian candidate passed 271 native environment
scenarios and was signed and staged unchanged. Debian SHA-256:
`157db654c7759d9a99bbf55d59ad56b33efcd21336d37a3a8eb18c841d24ce00`.
The configured-trust scenario replaces the two unconfigured-trust cases for
this variant. It verifies that automatic updates remain off and that a pinned
key alone does not create an installable offer. No release was published and
this qualification did not exercise a live download or privileged install.

### Ubuntu 22.04 reference candidate

A publisher-key-enabled `v0.1.6` amd64 Debian candidate built on Ubuntu 22.04
from source commit `7ce41a0` passed the release ABI check and 271 extracted-package
native environment scenarios. The package declared the glibc 2.35 baseline and
its highest required version was GLIBC_2.34. The same bytes passed 45 separate
packaged GitLab scenarios, including the catalogue.

The installer passed APT and package database checks in disposable Ubuntu
22.04, 24.04 and 26.04 and Debian 12 and 13 containers. The installed executable
and desktop entry matched the archive and the executable's shared libraries
resolved in every case. Stock Ubuntu 22.04 correctly refused the package with
Git 2.34; its successful test used the newer Git from the upstream-documented
Git PPA, configured only inside the disposable container. These are local
installation checks, not per-distribution installed WebDriver results.

The strict preflight matched the build receipt, ABI, native report and publisher
key before signing Debian SHA-256
`e430d3248f54017b8044191e17e1fa462cd5cfb3b832f8b6887c918f97db2411`.
The local staging set contains the signed manifest, unchanged package, package
and exact-source CycloneDX inventories, and verified `SHA256SUMS`. This is local
release evidence, not a published release or a verified live self-update.
Publication must preserve the exact package bytes behind the manifest URL and
must not substitute a rebuild or skip the release runtime matrix.

Before publication, verify the final staging directory again. Once the build
dependencies are cached, this needs neither the private key nor network access.
Pass the independently qualified digest
from the preflight above, **not** a digest read from the eventual upload's
`SHA256SUMS`:

```sh
cargo run --offline --locked -p git-khronos-desktop --example stage-debian-update -- \
  --verify-release "$RELEASE_DIRECTORY" "$PUBLIC_KEY_FILE" "$RELEASE_TAG" \
  "$QUALIFIED_PACKAGE_SHA256"
```

This requires the amd64 installer, canonical `latest.json`, both CycloneDX
inventories, and one exact checksum entry for each. It verifies the manifest's
version-bound signature and version-specific official URL against the same
package. The inventory checks are local integrity and format checks, not
signed provenance. The verifier does not create a tag or upload anything, and
the signed publication workflow still needs to consume the verified assets.

On Linux, a verified package can be downloaded even if the desktop cannot
authorize an in-app installation. For Debian and RPM, a missing or unusable
`/usr/bin/pkexec` disables the install action and suppresses automatic installer
dispatch; checking and signature verification still work. The dialog explains
that users can install the official release package with their system package
manager instead. This check does not imply that a functioning polkit session
exists, and there is no password-collection or `sudo` fallback.
