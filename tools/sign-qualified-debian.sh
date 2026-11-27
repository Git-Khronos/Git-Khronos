#!/usr/bin/env bash
# Internal signing primitive. The caller supplies a digest from verified qualification.
set +x
set -euo pipefail

prompt_key=
if [[ ${1:-} == --prompt ]]; then
  if (( $# != 5 )) || [[ ! -r $2 || ! -f $2 || -L $2 ]]; then
    echo 'Interactive signing requires a readable regular private key file.' >&2
    exit 2
  fi
  prompt_key=$2
  shift 2
fi
if (( $# != 3 )); then
  echo 'Usage: sign-qualified-debian.sh [--prompt PRIVATE_KEY_FILE] PACKAGE.deb QUALIFIED-SHA256 vMAJOR.MINOR.PATCH' >&2
  exit 2
fi
package=$1
digest=$2
tag=$3
if [[ ! "$digest" =~ ^[a-f0-9]{64}$ || ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Expected a qualified SHA-256 and a stable version tag.' >&2
  exit 2
fi
version=${tag#v}
installer="Git-Khronos_${version}_amd64.deb"
if [[ ${package##*/} != "$installer" || ! -f "$package" || -L "$package" ]]; then
  echo 'Expected the regular Debian installer matching the qualified release tag.' >&2
  exit 2
fi
if [[ -e "$package.sig" || -L "$package.sig" ]]; then
  echo 'Refusing to replace an existing signature.' >&2
  exit 1
fi
if [[ -z "$prompt_key" ]] && {
  [[ -n ${TAURI_SIGNING_PRIVATE_KEY:-} && -n ${TAURI_SIGNING_PRIVATE_KEY_PATH:-} ]] ||
  [[ -z ${TAURI_SIGNING_PRIVATE_KEY:-} && -z ${TAURI_SIGNING_PRIVATE_KEY_PATH:-} ]];
}; then
  echo 'Set exactly one Tauri signing key input in the signing environment.' >&2
  exit 2
fi

# Work beside the input so the final link is atomic and refuses replacement.
# The qualifier's input filename is not passed to the signer.
umask 077
work=$(mktemp -d -- "$(dirname -- "$package")/.git-khronos-sign.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp -- "$package" "$work/$installer"
matches_digest() {
  local actual
  actual=$(sha256sum < "$1") || return 1
  [[ ${actual%% *} == "$digest" ]]
}
if ! matches_digest "$work/$installer"; then
  echo 'Installer does not match the qualified SHA-256; not signing.' >&2
  exit 1
fi
if [[ -n "$prompt_key" ]]; then
  if [[ ! -t 0 ]]; then
    echo 'Open a terminal to enter the signing passphrase.' >&2
    exit 2
  fi
  unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$prompt_key"
  if ! IFS= read -rsp 'Signing key passphrase: ' TAURI_SIGNING_PRIVATE_KEY_PASSWORD; then
    printf '\nSigning cancelled.\n' >&2
    exit 1
  fi
  printf '\n' >&2
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
# Do not pass a credential on the command line or print the signer's output.
if ! pnpm exec tauri signer sign --app-version "$version" "$work/$installer" </dev/null >/dev/null 2>&1; then
  echo 'Tauri could not sign the qualified installer; check the signing credentials.' >&2
  exit 1
fi
if [[ ! -s "$work/$installer.sig" || ! -f "$work/$installer.sig" || -L "$work/$installer.sig" ]] ||
   ! matches_digest "$work/$installer" || ! matches_digest "$package"; then
  echo 'Installer changed or the signer did not produce a regular signature.' >&2
  exit 1
fi
if ! ln -T -- "$work/$installer.sig" "$package.sig"; then
  echo 'Could not publish the signature without replacing another file.' >&2
  exit 1
fi
