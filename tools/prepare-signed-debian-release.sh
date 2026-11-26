#!/usr/bin/env bash
# Assemble five verified release files. No key custody, networking API, or upload.
set -euo pipefail

if (( $# != 6 )); then
  echo "Usage: $0 CANDIDATE-DIRECTORY NATIVE-REPORT PUBLIC-KEY SIGNATURE TAG OUTPUT-PARENT" >&2
  exit 1
fi
candidate="$1"
report="$2"
key="$3"
signature="$4"
tag="$5"
output="$6"
if [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "Expected a release tag of the form vMAJOR.MINOR.PATCH." >&2
  exit 1
fi
version="${tag#v}"
installer="Git-Khronos_${version}_amd64.deb"
package_inventory="${installer%.deb}.cdx.json"
source_inventory="Git-Khronos_${version}_source.cdx.json"
# Fail before starting the stager, which creates the output directory.
for inventory in "$candidate/$package_inventory" "$candidate/$source_inventory"; do
  if [[ ! -f "$inventory" || ! -s "$inventory" || ! -r "$inventory" ]]; then
    printf 'Missing, empty, or unreadable release inventory: %s\n' "$inventory" >&2
    exit 1
  fi
done
# Compare a freshly generated, canonical list rather than following paths
# supplied by downloaded checksum metadata. This checks the candidate
# handoff; the package still needs independent evidence and a signature.
if ! qualified_checksums="$(
  cd -- "$candidate" || exit 1
  [[ -f "$installer" && ! -L "$installer" && -f SHA256SUMS && ! -L SHA256SUMS ]] || exit 1
  sha256sum -- "$installer" "$package_inventory" "$source_inventory"
)" || ! printf '%s\n' "$qualified_checksums" | cmp -s -- "$candidate/SHA256SUMS" -; then
  echo "Candidate package or inventories do not match the qualification artifact SHA256SUMS." >&2
  exit 1
fi
if [[ ! -d "$output" || ! -w "$output" || ! -x "$output" ]]; then
  printf 'Release staging needs an existing writable output directory: %s\n' "$output" >&2
  exit 1
fi
digest="$(node tools/check-debian-update-evidence.mjs --release-package \
  "$candidate/$installer" "$candidate/build-receipt.json" "$report" "$key")"

# Honor Cargo's normal offline settings when used from an offline operator machine.
work="$(mktemp -d -- "$output/git-khronos-release.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
stager=(cargo run --locked --quiet -p git-khronos-desktop --example stage-debian-update --)
if ! directory="$("${stager[@]}" "$candidate/$installer" "$signature" "$key" "$work" "$digest")"; then
  echo "Could not stage the exact Debian candidate with the supplied publisher signature." >&2
  exit 1
fi
cp -- "$candidate/$package_inventory" "$candidate/$source_inventory" "$directory/"
(
  cd -- "$directory"
  staged_checksums="$(sha256sum -- "$installer" "$package_inventory" "$source_inventory")"
  if [[ "$staged_checksums" != "$qualified_checksums" ]]; then
    echo "Candidate files changed after the qualification checksum check; refusing to stage them." >&2
    exit 1
  fi
  sha256sum -- "$installer" "$package_inventory" "$source_inventory" latest.json > SHA256SUMS
)
"${stager[@]}" --verify-release "$directory" "$key" "$tag" "$digest" >&2
rm -- "$directory/update-assets.sha256"
trap - EXIT
printf '%s\n' "$directory"
