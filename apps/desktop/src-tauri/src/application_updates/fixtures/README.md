# Owned updater verification fixtures

These public fixtures were independently generated with the workspace Tauri CLI
2.12.1. `payload` is inert text with an ELF magic prefix, not an executable or
installable application. `payload.sig` binds version `0.2.0`; `unversioned.sig`
intentionally omits the signed version. Only the public verification key is
stored here. The ephemeral private fixture key is outside source control and
is not release trust. Tests never invoke a privileged installer.

The four minimal Debian archives contain only an independently written control
file (no scripts or application files). They exercise exact package name,
version and amd64/arm64 architecture matching. Every signature binds `0.2.0`,
including the deliberately mismatched `wrong-version.deb` control metadata.
They were built with `dpkg-deb --build --root-owner-group` and signed with
`pnpm exec tauri signer sign --app-version 0.2.0`; none was installed.
