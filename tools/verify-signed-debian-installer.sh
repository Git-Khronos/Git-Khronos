#!/usr/bin/env bash
# Verify a downloaded installer with an independently trusted Tauri public key.
set -euo pipefail
if (( $# != 3 )) || [[ ! $1 =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  printf 'Usage: %s vMAJOR.MINOR.PATCH PACKAGE.deb TRUSTED_PUBLIC_KEY\n' "${0##*/}" >&2
  exit 2
fi

version="${1#v}"
package="$2"
key="$3"
filename="Git-Khronos_${version}_amd64.deb"
[[ $package = /* ]] || package="$PWD/$package"
if [[ ${package##*/} != "$filename" || ! -f $package || ! -f $package.sig || ! -f $key ]]; then
  printf 'Expected %s, its adjacent .deb.sig, and an independently trusted public-key file.\n' "$filename" >&2
  exit 1
fi
if ! command -v minisign >/dev/null; then
  printf 'Minisign is required. Install it through your trusted package manager.\n' >&2
  exit 1
fi

umask 077
verification="$(mktemp -d)"
cleanup() {
  for file in "$verification/publisher.pub" "$verification/package.minisig"; do
    if [[ -e $file ]]; then unlink -- "$file"; fi
  done
  rmdir -- "$verification"
}
trap cleanup EXIT
base64 -d < "$key" > "$verification/publisher.pub"
base64 -d < "$package.sig" > "$verification/package.minisig"
if ! comment="$(minisign -VQ -m "$package" -x "$verification/package.minisig" -p "$verification/publisher.pub")"; then
  printf 'Publisher signature verification failed; do not install this archive.\n' >&2
  exit 1
fi
prefix="${comment%%$'\t'*}"
if [[ ! $prefix =~ ^timestamp:[0-9]+$ || $comment != "$prefix"$'\t'"file:$filename"$'\t'"version:$version" ]]; then
  printf 'Signature verified, but its authenticated filename or version does not match %s.\n' "$filename" >&2
  exit 1
fi
printf 'Verified publisher signature for %s (version %s).\n' "$filename" "$version"
