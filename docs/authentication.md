# Standard Git authentication

Git Chronos uses system Git for HTTPS and OpenSSH for SSH. Existing Git credential
helpers and SSH agents are tried normally. Git Chronos does not keep credentials
in application settings or its activity history.

## Explicit operations

Fetch, Pull, Push, publish, clone, submodule transport and LFS transport can request
a username, password, or SSH key passphrase. A focused, keyboard-accessible modal
identifies the operation and repository. Paste and password-manager autofill work.
Submitting an answer permits Git to continue; only Git's configured credential
helper decides whether to save it. SSH agent persistence remains external.

Cancel or Escape cancels the operation. Requests also expire after 110 seconds.
Cancellation terminates the Git process tree using the existing platform runner;
it does not roll back remote changes or promise to remove partial clone data.
Repository mutations retain the existing failure/cancellation refresh lifecycle.
Retry the original operation after a rejected credential.

## Background fetch

Background fetch never opens the authentication modal. It uses available saved
credentials and SSH agent keys, disables interactive Git/GCM authentication and
uses OpenSSH batch mode. A failure remains visible in the existing fetch-status
control; automatic retries pause until an explicit successful Fetch. Clicking the
status control performs an explicit fetch, which can request credentials.

Custom credential helpers are user-configured external programs. Git Chronos
cannot prevent a helper which ignores Git/GCM's noninteractive controls from
launching its own interface. Use helpers supporting noninteractive retrieval for
background fetch.

## SSH trust and supported configuration

OpenSSH receives `StrictHostKeyChecking=yes` for every transport. Unknown and
changed keys are rejected, never accepted through askpass. Verify the server's
fingerprint independently and establish trust outside Git Chronos before retrying.

Standard password and encrypted-key passphrase prompts are supported. SSH agent
keys and `~/.ssh/config` host/identity/proxy settings remain available. Arbitrary
keyboard-interactive/MFA prompts, PuTTY/Plink, custom `GIT_SSH` executables and
`core.sshCommand` overrides are not supported by this bridge. The transport
explicitly selects OpenSSH; put supported identity/host settings in SSH config.
HTTPS URLs containing user information and SSH URLs containing passwords are
rejected, including configured remote URLs and URL rewrite bases. Remove embedded
credentials and use a helper or the modal instead.

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
successful fetch and push. Fixture trust comes from a fixture-only SSH config added
by a test `ssh` wrapper; the app's forced OpenSSH options stay in effect and the
user's SSH directory and agent are not used. Run it with
`GIT_CHRONOS_SSHD=/absolute/path/to/sshd cargo test -p git-chronos-desktop --test ssh_transport -- --include-ignored`;
a missing `sshd` is a test failure.

Both transport suites can drive a packaged executable as the askpass helper in
place of the test build. Set `GIT_CHRONOS_PACKAGED_BINARY` to the
`usr/bin/git-chronos-desktop` extracted from a built Debian package
(`dpkg-deb -x`), then run
`cargo test -p git-chronos-desktop --test authentication_transport --test ssh_transport -- --include-ignored`.
A locally built `.deb` has passed both suites this way. That shows the shipped
binary contains the askpass entry point. It does not qualify installation through
a package manager.

Production HTTPS servers/proxies, production SSH servers (agents, MFA, proxies),
system-installed Linux packages, macOS and Windows still require acceptance qualification.
