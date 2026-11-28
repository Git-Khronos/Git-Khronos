# Application updates

Status: the manual and opt-in controls are implemented. Local publisher-key
builds and signed test assets exist; the public update feed and end-to-end
privileged installation are not yet qualified.

## User-facing requirements

- Provide an application-level **Updates** menu entry with a manual check and
  explicit download/install controls. It must work without an open repository.
- With a repository open, searching the command palette for **Application
  Updates** or **check for updates** opens the same dialog. Opening it does
  not check for updates or change automatic consent.
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
The background scheduler checks every six hours after opt-in when it has no
verified package awaiting a decision. A check cannot replace a verified package
just because automatic mode was enabled or re-enabled, or while an authorized
update is waiting for idle native work. An explicit manual check can replace
the current offer. Automatic installation still requires a current
automatic-origin lease and an idle native activity snapshot.
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
install or enable automatic updates. Native status may also be slow or unavailable:
the dialog keeps **Refresh status** and the fixed **Browse official releases**
action available without waiting for that status. Browsing opens the official site;
it does not install anything or enable automatic updates. If a refresh fails
after a known status, the dialog labels it as last known and blocks new checks,
downloads, installations and opt-in until a valid native reply or event arrives.
The user can still turn off a previously confirmed automatic preference.
For a verified package that cannot be installed yet, native status explains
the current blocker separately from the earlier outcome: open editors, diff
or merge tools, terminal sessions, Git work, or unavailable system package
authorization. The button stays disabled until native readiness changes.
An older read or action reply cannot override a newer valid native event at the
same revision. Native activity can change whether installation is available
without incrementing the update model's revision, so a newly started poll can
still report that the app is idle again. The release publisher must separately
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
The controller tests now pass real signed inert Debian payloads through the
production download verifier and state settlement. They verify that opt-out
keeps the accepted bytes available for an explicit manual install, that a
signed package with incorrect metadata never becomes ready, and that a
retired read cannot attach bytes to a newer offer. These tests do not start
HTTPS delivery or invoke an installer. Cross-installation receipt ownership,
public feed qualification and remaining platform install/restart acceptance
still need verification.

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
requires the Jammy build profile, an **installed** environment report with
passing initial and final Git integrity checks, and matching hashes for the
installed executable and desktop entry. It repeats the release ABI check on a
private snapshot of the exact package and matches its version to the running
version in the report:

```sh
QUALIFIED_PACKAGE_SHA256=$(node tools/check-debian-update-evidence.mjs \
  --release-package "$PACKAGE" "$BUILD_RECEIPT" "$NATIVE_REPORT" "$PUBLIC_KEY_FILE") || exit 1
```

These are operator-owned local records, not signed provenance attestations.
For a local test build only, omit `--release-package` to check the matching
build and runtime evidence without asserting installation or the Ubuntu ABI.
An extracted-package report cannot qualify a release. The release stager
separately verifies the actual package bytes.

After offline staging, you can rehearse manifest consumption using the real
updater library in a mock app runtime. Supply the prepared assets, the same
public key, the qualified digest and an older baseline version:

```sh
GIT_KHRONOS_STAGED_RELEASE_DIR="$STAGED_DIRECTORY" \
GIT_KHRONOS_STAGED_PUBLIC_KEY="$PUBLIC_KEY_FILE" \
GIT_KHRONOS_QUALIFIED_PACKAGE_SHA256="$QUALIFIED_PACKAGE_SHA256" \
GIT_KHRONOS_STAGED_BASELINE_VERSION="$BASELINE_VERSION" \
  cargo test --locked -p git-khronos-desktop --example stage-debian-update \
  qualified_release_can_be_consumed_offline -- --ignored
```

The test requires no private key. It verifies that the older runtime
accepts the offer and package signature, and that the offered version
receives no upgrade. It does not fetch, authorize or install an update.

With `PACKAGE` (absolute path), `VERSION`, `PRIVATE_KEY_FILE`, `PUBLIC_KEY_FILE`,
`STAGING_PARENT` (existing directory), and `QUALIFIED_PACKAGE_SHA256` set:

```bash
bash tools/sign-qualified-debian.sh --prompt "$PRIVATE_KEY_FILE" \
  "$PACKAGE" "$QUALIFIED_PACKAGE_SHA256" "v$VERSION" || exit 1
cargo run --locked -p git-khronos-desktop --example stage-debian-update -- \
  "$PACKAGE" "$PACKAGE.sig" "$PUBLIC_KEY_FILE" "$STAGING_PARENT" \
  "$QUALIFIED_PACKAGE_SHA256"
```

The signing helper refuses a checksum mismatch or an existing sidecar. The
passphrase is entered without echo and stays in the signing process and its
signer child; do not paste it into GitHub or chat.
Only the resulting public `.deb.sig` is needed by the publication workflow.

The stager prints a new directory containing the verified package, a
`latest.json` manifest, and `update-assets.sha256`. It streams the signed bytes
into owned staging, checks the exact qualified digest, and rejects mismatched
package metadata, architecture, and signed version. No signing secret is needed
for staging. Neither qualification nor local staging publishes anything. The
separate **Publish signed Debian release** workflow can publish only when
publication is explicitly enabled and the protected environment approves it.
The release tag and asset name must match the staged URL.

### Optional release signing in CI

Release signing may be automated without giving ordinary PR, dev, or
qualification jobs access to the key. Offline signing remains the default.
Hosted mode has two separate review checkpoints per stable release: one for
signing and the existing one for publication. Neither applies to ordinary
builds.
Moving the key into an environment secret changes its custody: the approved
runner can read it. A separate signing service is needed if the key must
remain outside GitHub Actions. After the updated workflow lands on `main`,
configure a `signed-release-signer` environment with required reviewers and
exactly one allowed branch (`main`). Add `TAURI_SIGNING_PRIVATE_KEY` and, if
needed, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as secrets **only** in that
environment. Use `GIT_KHRONOS_HOSTED_SIGNING_ENABLED=true` to opt in and set
`hosted_signing=true` when dispatching publication, leaving `signature` empty.
Run `task release:preflight -- --hosted v0.1.6` to check the GitHub configuration.
It checks the signer secret name only, not its contents or correctness.
Set `verification_only=true` for a signing-and-verification rehearsal. It
prevents publication even if the repository publication switch is enabled.
As with offline mode, the separate publication switch and `signed-release`
approval are required before anything goes live.

Before the signing job opens the signing secrets, a read-only job must
verify the successful candidate attempt, the tag commit, the complete
qualification evidence, and the archive digest. The signer must recheck that
digest before signing. It must have no repository write permission, must
not rebuild the package or run the candidate executable, and may hand off
only the exact archive and its public signature or their immutable artifact
references. The publishing job must not receive the private key. It must
reverify the public signature, tag, version and asset digests before
publishing. Do not enable this path until test-key acceptance proves that a
wrong digest, wrong key, moved tag, or failed qualification cannot publish.

Installations built without the public key need a one-time manual upgrade to a
trusted build. They cannot use a release manifest to establish trust in its own
signer. Automatic updates remain off until the user opts in.

Debian packages built with the packaging task show a **Running build ID** in
Updates. It identifies the package build inputs, flavor, and compiled publisher
configuration, so local builds with the same version can be told apart. It is
not a package checksum or a trust check; use `task install:linux:status` to
compare the installed files with an exact reviewed archive. Older builds and
builds without this metadata omit the row.

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
signed provenance. The verifier does not create a tag or upload anything. The manual workflow
below runs the same verifier on the assets it will hand off for publication.

### Key custody and contributors

Contributors can build, test, and submit changes without any production key.
A local build without a publisher key can open the official releases page but
cannot install an unsigned update. Use a separate fixture key to test signing
and verification locally. A fork that distributes its own updates needs its
own publisher key and release configuration; official installations do not
trust that key.

Keep the production private key and passphrase in offline publisher custody.
Contributors can prepare a candidate and its evidence without signing it. The
publisher signs the exact qualified package and hands off its public
`.deb.sig`; the publication workflow verifies the signature and does not
receive the private key. Official builds embed only the public key from the
repository Actions variable.

Generate the production key pair **once**, on the machine used for offline
signing. From a Linux or macOS checkout with the pinned Node and pnpm
dependencies installed:

```sh
task signer:generate
```

The task writes the pair to `$HOME/.config/git-khronos-signing/` and refuses
to replace either existing key file. Enter a strong passphrase when prompted.
Back up the encrypted
`git-khronos.key` privately and keep the passphrase separate. Set
`GIT_KHRONOS_UPDATER_PUBLIC_KEY` to the **contents** of
`git-khronos.key.pub`, not to its path. Do not regenerate the pair for each
release: already-installed builds continue to trust the key they shipped
with. See [Tauri's updater signing guide](https://v2.tauri.app/plugin/updater/#signing-updates)
for signer behavior.

### Publishing the signed GitHub release

The release and publication workflows are separate, manual runs on the
official repository's `main` branch. Creating a tag no longer builds or
publishes a release from the updated workflow. Ensure the tag is on a commit
containing the updated workflow: a tag pointing at an older commit can still
select its old tag-triggered workflow. Protect stable version tags against
changes and deletion.

1. Set the repository Actions variable `GIT_KHRONOS_UPDATER_PUBLIC_KEY`
   to the publisher **public** key file contents. Before allowing publication,
   configure the `signed-release` environment to allow only `main` and require
   release reviewers. Set repository variable
   `GIT_KHRONOS_SIGNED_PUBLICATION_ENABLED` to `true` only after configuring
   those protections. The private key and passphrase never enter GitHub.
2. Dispatch **Qualify Debian release candidate** on `main` with the existing
   stable tag (for example, `v0.1.6`). Wait for the whole run to pass. Download
   `debian-candidate-<attempt>` and `debian-candidate-evidence-<attempt>`
   plus all `debian-runtime-reports-<attempt>-*` artifacts from that run.
   The package is built once and qualifies unchanged on five Linux baselines.
   The Jammy publisher suite runs separately from Jammy smoke and GitLab.
   If a rerun does not produce the complete artifact set under its own
   attempt, start a fresh candidate run rather than mixing attempts.
3. On a prepared Linux checkout, download and check the complete successful
   attempt in one step:

   ```sh
   task release:download -- "$RELEASE_TAG" "$RUN_ID"
   ```

   The default uses the locally trusted public key created by
   `task signer:generate` and stores the download where `task sign` looks for
   it. To override both, append `"$PUBLIC_KEY_FILE" "$OUTPUT_PARENT"` to the
   command and give it an existing output directory. The task prints the package path and qualified digest only after checking
   the tag, workflow attempt, package evidence and installed matrix. It
   does not sign, install, or publish. If downloading manually, use the
   downloaded `.deb`, `build-receipt.json`, and evidence
   `report.json` for the strict preflight and offline signature command above.
   Preserve the runtime artifacts in separate directories under
   `candidate-matrix/`. Before signing, verify the installed matrix with
   `node tools/report-installed-acceptance.mjs --verify-release "$BUILD_RECEIPT" "$PUBLIC_KEY_FILE" "$PACKAGE" --reports-dir candidate-matrix`.
   Sign those exact package bytes without rebuilding. The artifact is retained
   for seven days; preserve it and the evidence separately for longer reviews.
   On the publisher's Linux checkout, run `task sign` from a terminal to sign
   the sole unsigned qualified download under
   `target/local-review/hosted-release-integration`. Already signed downloads
   are left alone. For another location or multiple unsigned downloads, use
   `task sign -- /path/to/qualified-release-directory`. This prompts locally
   and writes only the public sidecar; it does not publish.
4. Dispatch **Publish signed Debian release** on `main` with the tag, candidate
   run ID, and only the **public** `.deb.sig` content. The read-only verification
   job checks the successful run, attempt, exact tag commit, qualification
   digest, installed matrix, and publisher signature before creating
   `latest.json`. Reviewers can download the verified matrix separately
   from the signed assets. With
   publication disabled, the workflow stops after retaining the verified
   assets for review. To approve an enabled release, review the workflow inputs
   and verification outcome in the protected deployment.
5. The write job rechecks the transferred files and tag and refuses to replace
   the current stable release with an equal or older version. It publishes only
   the installer, its public `.deb.sig`, signed manifest, two inventories, and
   checksums. The sidecar repeats the exact signature in `latest.json` for
   offline verification of a manually downloaded package. Confirm the
   public manifest matches the staged manifest. In a disposable supported
   installation with an **older version and the same pinned production key**,
   check for the offer, verify the signed download, install it, restart, and
   confirm the new version reports no further update. A baseline without that
   key must be upgraded manually; a check from the just-published version
   cannot prove upgrade behavior. If this is the first release with that key
   and no trusted older baseline is available, record the live upgrade as
   unverified rather than substituting the offline rehearsal. An already
   published tag is not a repair target for this workflow.

### Verify a manually downloaded Debian installer

For releases with a `.deb.sig` asset, use the publisher's public key obtained
from a source you already trust—not a key furnished alongside an untrusted
download. The Tauri key and sidecar are Base64-wrapped
[Minisign](https://jedisct1.github.io/minisign/) files. Install Minisign through your trusted package manager and put the
downloaded `.deb.sig` beside the `.deb`. For example:

```sh
task release:verify-installer -- v0.1.7 "$PACKAGE" "$PUBLIC_KEY_FILE"
```

This verifies the signature and requires the authenticated filename and version
to match the requested release. It checks publisher authenticity, not just
whether a download matches a checksum listed on the same page. It does not
install the package. Without a source checkout, decode the Tauri public key
and sidecar using `base64 -d`, then run
`minisign -Vm "$PACKAGE" -x "$DECODED_SIGNATURE" -p "$DECODED_PUBLIC_KEY"`.
Check that the verified comment identifies the intended filename and version.

### Verify automatic updates after the first signed release

Before a newer release exists, opt in to the read-only live baseline check
with `GIT_KHRONOS_NATIVE_CHECK_PUBLIC_BASELINE=1` and
`GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST=1` when running
`desktop:native-application-updates` against the exact current signed release.
It checks the public feed with a temporary profile, without changing automatic
consent, downloading an installer, or installing anything. It expects no
newer release and is not a replacement for the two-release test. If the
checkout version differs from the public baseline, pass the original archive,
its reviewed SHA-256, and its exact version:

```sh
GIT_KHRONOS_NATIVE_CHECK_PUBLIC_BASELINE=1 GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST=1 \
  pnpm nx run desktop:native-application-updates -- \
  --package "$archive" --expect-package-sha256 "$sha256" --expect-package-version "$version"
```

This version override is restricted to the extracted application-updates suite.
Other qualification suites still require the checkout's package version.

After a newer signed release is published, you can separately check whether
the older app sees the exact offer without installing anything. Run the same
command against the older archive, replacing
`GIT_KHRONOS_NATIVE_CHECK_PUBLIC_BASELINE=1` with
`GIT_KHRONOS_NATIVE_EXPECT_PUBLIC_UPDATE=x.y.z` (the newer version).
It checks the displayed offer and confirms that no download or installation
started. This tests the feed and offer, not automatic installation.

Use a disposable supported Debian or Ubuntu desktop with working polkit.
Install the first official signed Debian release once from its GitHub release
assets. Leave automatic updates off until a **strictly newer** signed Debian
release with the same pinned key is public and its `latest.json` is available.
Then, in the older installation:

1. Open **Updates** and confirm the old running version. Enable automatic
   updates without pressing **Check for updates**, **Download**, or **Install**.
   Enabling resets the next-check deadline; let the scheduler run.
2. Keep Git operations, terminal sessions, and editors idle. Observe the offer
   and verification; approve only the OS authorization for the expected
   update. An authorization prompt is compatible with automatic dispatch.
3. When the app reports that a restart is needed, quit and relaunch. Confirm
   the newer running version and the installed package version with
   `dpkg-query -W git-khronos`. Record the baseline, both release tags, the
   published package checksum, and whether any manual action besides consent,
   OS authorization, and relaunch was required.

Downloading or installing the second release by hand does not pass this check.
Neither does validating just the manifest or testing the offline updater.

On Linux, a verified package can be downloaded even if the desktop cannot
authorize an in-app installation. For Debian and RPM, a missing or unusable
`/usr/bin/pkexec` disables the install action and suppresses automatic installer
dispatch; checking and signature verification still work. The dialog explains
that users can install the official release package with their system package
manager instead. This check does not imply that a functioning polkit session
exists, and there is no password-collection or `sudo` fallback.

The updater rechecks the installed version before starting authorization.
For Debian it also passes `--refuse-downgrade` to the actual dpkg
transaction, so another update completing while authorization is pending
cannot turn the older reviewed offer into a downgrade. Installer exit status
alone never confirms the offered version.
