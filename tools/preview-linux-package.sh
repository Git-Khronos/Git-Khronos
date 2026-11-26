#!/usr/bin/env bash
# Run a reviewed Debian archive without installing it or using the normal app profile.
set -euo pipefail

if (( $# != 2 )) || [[ ! $2 =~ ^[a-fA-F0-9]{64}$ ]]; then
  printf 'Usage: bash tools/preview-linux-package.sh PACKAGE.deb REVIEWED_SHA256\n' >&2
  exit 2
fi
if (( EUID == 0 )); then
  printf 'Run the preview as your desktop user, not as root.\n' >&2
  exit 2
fi
if [[ ! -f $1 || ! -r $1 ]]; then
  printf 'Choose a readable regular Debian archive: %s\n' "$1" >&2
  exit 2
fi
for tool in sha256sum dpkg-deb dbus-run-session; do
  command -v "$tool" >/dev/null || { printf 'Missing preview tool: %s\n' "$tool" >&2; exit 2; }
done

session=$(mktemp -d)
session=$(cd -- "$session" && pwd -P)
trap 'rm -rf -- "$session"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 -- "$session/home" "$session/payload"
archive="$session/archive.deb"
cp -- "$1" "$archive"
if [[ $(sha256sum -- "$archive" | cut -d ' ' -f 1) != "${2,,}" ]]; then
  printf 'Archive checksum does not match the reviewed SHA-256. Nothing launched.\n' >&2
  exit 1
fi
if [[ $(dpkg-deb -f "$archive" Package) != git-khronos ]] ||
   [[ $(dpkg-deb -f "$archive" Architecture) != amd64 ]] ||
   [[ $(uname -m) != x86_64 ]]; then
  printf 'The preview requires a Git Khronos amd64 Debian package on Linux x86-64.\n' >&2
  exit 1
fi
dpkg-deb --extract "$archive" "$session/payload"
app="$session/payload/usr/bin/git-khronos"
[[ -f $app && ! -L $app && -x $app ]] || { printf 'Missing packaged executable.\n' >&2; exit 1; }

# Use the caller's display credentials, but not their app settings or D-Bus session.
if [[ -n ${DISPLAY:-} && ! -v XAUTHORITY && -f ${HOME:-}/.Xauthority ]]; then
  export XAUTHORITY="$HOME/.Xauthority"
fi
cd "$session/home"
printf 'Opening the verified package with a temporary profile. Nothing is installed.\n'
printf 'Only open disposable Git repositories: repository changes are not isolated.\n'
env -u AT_SPI_BUS_ADDRESS -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
  HOME="$session/home" dbus-run-session -- "$app"
