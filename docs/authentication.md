# Standard Git authentication

Git Khronos uses system Git for HTTPS and OpenSSH for SSH. Existing Git credential
helpers and SSH agents are tried normally. Git Khronos does not keep credentials
in application settings or its activity history.

## Explicit operations

Fetch, Pull, Push, publish, clone, submodule transport and LFS transport can request
a username, password, or SSH key passphrase. A focused, keyboard-accessible modal
identifies the operation and repository. Paste and password-manager autofill work.
Submitting an answer permits Git to continue; only Git's configured credential
helper decides whether to save it. SSH agent persistence remains external.

Cancel or Escape requests cancellation. Requests also expire after 110 seconds.
Accepted cancellation terminates the Git process tree using the existing platform runner;
it does not roll back remote changes or promise to remove partial clone data.
Repository mutations retain the existing failure/cancellation refresh lifecycle.
Retry the original operation after a rejected credential.

A credential prompt alone does not imply that authentication failed. If Git
authenticates and then rejects a push, the error directs you to inspect remote
history rather than re-enter credentials. Recognized TLS failures likewise retain
their certificate-verification guidance. Explicit authentication failures still
take precedence over these diagnostics; unrecognized failures after a prompt
retain authentication guidance. Raw transport output is never displayed.

TLS guidance requires a recognized failure diagnostic, including Git's OpenSSL
verification-result errors, not just `ssl` or `certificate` in a repository name
or quoted URL. Unknown transport diagnostics retain general remote/network
guidance; certificate checks are never disabled as a workaround.

For recognized Git message formats, quoted missing-repository names and URL
targets are excluded from diagnostic matching. A name such as
`authentication failed.git` must not turn a missing local repository into an
authentication or host-trust failure. Push-rejection guidance is scoped to Push;
genuine authentication, SSH trust and TLS failures retain their specific guidance.

Bounded LFS server lock JSON reads use the same transport configuration as their verification
requests, including any active authentication scope. A later authenticated probe
must not turn an earlier unauthenticated failure into an empty lock list. Output
limits remain enforced; cancellation and size refusal terminate the owned process
group, including descendants holding output pipes open. The native lock-list and
lock/unlock commands currently use saved Git credentials rather than opening an
interactive authentication scope; the core scoped-authentication regression does
not establish native dialog support for those commands.
Local `lfs env` and `lfs ls-files` metadata reads do not receive transport-only
configuration; effective-settings fingerprints remain comparable before and
inside an authenticated fetch.

If the cancellation request fails, the dialog dismisses that prompt and shows a
nonblocking warning that cancellation could not be confirmed. The Git operation
may still be running: check its status before retrying. Other queued prompts keep
their own submission and error state; a late reply cannot unlock a newer pending
answer. Listener ownership is released even if initialization stops partway
through registration or the component is destroyed before a reply arrives.

The authentication interface loads immediately after the main view renders.
Its pending-request lookup recovers requests created before its listeners connect.
A failed interface download shows a dismissible warning to preserve drafts and
restart before retrying operations that require authentication.

## Background fetch

Background fetch never opens the authentication modal. It uses available saved
credentials and SSH agent keys, disables interactive Git/GCM authentication and
uses OpenSSH batch mode. A failure remains visible in the existing fetch-status
control; automatic retries pause until an explicit successful Fetch. Clicking the
status control performs an explicit fetch, which can request credentials.

Custom credential helpers are user-configured external programs. Git Khronos
cannot prevent a helper which ignores Git/GCM's noninteractive controls from
launching its own interface. Use helpers supporting noninteractive retrieval for
background fetch.

## SSH trust and supported configuration

OpenSSH receives `StrictHostKeyChecking=yes` for every transport. Unknown and
changed keys are rejected, never accepted through askpass. Verify the server's
fingerprint independently and establish trust outside Git Khronos before retrying.

Standard password and encrypted-key passphrase prompts are supported. SSH agent
keys and `~/.ssh/config` host/identity/proxy settings remain available. Arbitrary
keyboard-interactive/MFA prompts, PuTTY/Plink, custom `GIT_SSH` executables and
`core.sshCommand` overrides are not supported by this bridge. The transport
explicitly selects OpenSSH; put supported identity/host settings in SSH config.
HTTPS URLs containing user information and SSH URLs containing passwords are
rejected, including configured remote URLs and URL rewrite bases. Remove embedded
credentials and use a helper or the modal instead.

Endpoint review also covers `lfs.url`, `lfs.pushurl`, and per-remote LFS endpoint
settings at network boundaries. Git parses the ordinary configuration and the
documented `.lfsconfig` source: the working file, then its index entry, then HEAD;
bare repositories use HEAD. Ordinary Git configuration overrides the same file
key, and later values retain Git's precedence. A configured safe override remains
usable. Each endpoint-configuration query captures at most 512 KiB of matching
output, whether it comes from ordinary Git configuration or the selected file.
Inspection remains cancellable; oversized output is refused before transport,
with guidance to reduce matching URL configuration. An unreadable or invalid
selected file is not treated as proof that configuration is safe.
Local LFS metadata commands do not gain endpoint preflight or transport settings.
Lock-list errors retain credential-policy, TLS, and SSH-trust guidance instead of
replacing them with a generic server-unavailable message.

This qualifies preflight of existing repositories. Configuration introduced by
clone templates or a newly checked-out nested repository remains a separate
acceptance boundary; it is not established by the existing-repository tests.

Before cloning, Git Khronos asks Git to expand the requested URL with
`ls-remote --get-url`, which does not contact the remote. This review uses the
new destination's configuration context, including matching `gitdir` and
`hasconfig:remote.*.url` includes; unrelated settings local to the launching
repository do not govern the clone. The selected expanded URL must pass the
same embedded-credential check. Configuration review remains cancellable.
If review refuses the clone, only its newly reserved empty directory is removed;
nonempty partial clones and existing destinations are never recursively deleted.
The pre-creation review does not inspect configuration copied into the new
repository by a custom Git template. Actual transport commands additionally force
Git's `transfer.credentialsInUrl=die` safeguard, so password-bearing template
rewrites are refused even when global configuration requests `allow`. The refusal
is classified without forwarding Git's URL diagnostics. Safe templates and their
files remain supported. HTTP username-only URLs supplied by templates are still
an unqualified policy boundary: Git's password guard does not cover that case.

## Runtime and verification boundary

The shipped desktop executable contains an early askpass entry point before Tauri
startup. Git/OpenSSH execute that same binary; no generated scripts, separately
unshipped helpers, global environment updates or helper shell files are required.
Each operation receives an ephemeral loopback listener and an OS-random capability
token via its child environment. Responses travel over that socket, then the
helper's stdout to Git/OpenSSH. Secrets never appear in application-generated
command arguments or authentication events. Raw transport stderr is deliberately
not sent to the renderer: classified errors avoid arbitrary helper/remote secret
disclosure.

Tests exercise real Git HTTP and loopback HTTPS smart-Git authentication, the shipped executable helper
(including an executable path containing spaces), helper-owned credential
persistence, rejection/cancellation and quiet background failure. The SSH helper
entry point and refusal of host-trust prompts are exercised natively; strict SSH
options are asserted. Renderer tests qualify modal interaction and clearing.
The HTTPS fixture generates an ephemeral certificate with OpenSSL, trusts it only
in the fixture repository, and serves actual `git-http-backend` negotiation through
Python's standard-library TLS server. It verifies untrusted-certificate refusal,
shipped askpass prompts, rejected credentials, retries, cancellation, quiet
background failures and helper-owned saved-credential background success. No TLS
verification bypass, global configuration or external service is used. These
tests require existing OpenSSL, Python SSL support and `git-http-backend`; missing
tooling is a test failure, not a simulated success.

An optional live SSH fixture starts a disposable, unprivileged OpenSSH `sshd` on
loopback with generated host and passphrase-protected client keys, then drives real
`git-upload-pack`/`git-receive-pack` sessions. It verifies that unknown and changed
host keys are refused without prompting or rewriting `known_hosts`, quiet background
failure, rejected passphrases through the shipped askpass, cancellation, and
successful fetch and push. A divergent push after successful passphrase entry must
report a push rejection and preserve the remote tip, local HEAD, index and working
file. Fixture trust comes from a fixture-only SSH config added
by a test `ssh` wrapper; the app's forced OpenSSH options stay in effect and the
user's SSH directory and agent are not used. Run it with
`GIT_KHRONOS_SSHD=/absolute/path/to/sshd pnpm nx run desktop:test-ssh`;
a missing `sshd` is a test failure.

The fixture creates a fresh private directory exclusively; it never removes a
pre-existing directory to prepare a run. An OpenSSH server extracted into a
local tools directory can be selected with `GIT_KHRONOS_SSHD`; installing a
system service is not required. Recent OpenSSH packages must also include their
`usr/lib/openssh/sshd-session` and `sshd-auth` helpers, which the fixture selects
from the same extracted prefix. Host prerequisites still apply: a startup
failure is not a passing qualification and must not be worked around by changing
personal SSH configuration or starting a system service.

Both transport suites can drive a packaged executable as the askpass helper in
place of the test build. Set `GIT_KHRONOS_PACKAGED_BINARY` to the
`usr/bin/git-khronos` extracted from a built Debian package
(`dpkg-deb -x`), then run
`cargo test -p git-khronos-desktop --test authentication_transport --test ssh_transport -- --include-ignored`.
A locally built `.deb` has passed both suites this way. That shows the shipped
binary contains the askpass entry point. It does not qualify installation through
a package manager.

Production HTTPS servers/proxies, production SSH servers (agents, MFA, proxies),
system-installed Linux packages, macOS and Windows still require acceptance qualification.
