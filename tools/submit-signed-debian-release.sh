#!/usr/bin/env bash
# Submit only a verified public sidecar to the reviewer-protected workflow.
set +x
set -euo pipefail
if (( $# != 1 )) || [[ ! -d "$1" ]]; then
  echo 'Usage: task release:submit -- QUALIFIED_RELEASE_DIRECTORY' >&2
  exit 2
fi
tools="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
directory="$(cd -- "$1" && pwd -P)"
candidate="$directory/candidate"
record="$directory/qualified-package.sha256"
[[ -f "$record" && ! -L "$record" ]] || { echo 'Download a qualified candidate first.' >&2; exit 2; }
entry=$(<"$record")
pattern='^([a-f0-9]{64})  (Git-Khronos_((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))_amd64\.deb)$'
[[ "$entry" =~ $pattern ]] || { echo 'Invalid qualified package checksum record.' >&2; exit 1; }
digest=${BASH_REMATCH[1]} name=${BASH_REMATCH[2]} tag="v${BASH_REMATCH[3]}"
archive="$candidate/$name"
signature="$archive.sig"
if [[ ! -f "$archive" || -L "$archive" || ! -s "$signature" || ! -f "$signature" || -L "$signature" ]]; then
  echo 'Run task sign on the qualified candidate before submitting it.' >&2
  exit 2
fi
run="$(jq -er '.runId | strings' "$candidate/candidate.json")"
[[ "$run" =~ ^[1-9][0-9]{0,15}$ ]] || { echo 'Invalid candidate run ID.' >&2; exit 1; }
commit="$(jq -er '.commit | strings' "$candidate/candidate.json")"
node "$tools/check-debian-candidate-run.mjs" "$directory/candidate-run.json" "$run" "$candidate/candidate.json" "$tag" "$commit"
remote_tag="$(git ls-remote --exit-code https://github.com/Git-Khronos/Git-Khronos.git "refs/tags/$tag^{}")"
if [[ "$remote_tag" != "$commit"$'\t'"refs/tags/$tag^{}" ]]; then
  echo 'The official annotated tag no longer identifies the qualified commit.' >&2
  exit 1
fi

# Pin verification and submission to one private copy. Never submit arbitrary
# file contents from the source path, even if it changes after this check.
umask 077
work="$(mktemp -d)"
cleanup() {
  for file in "$work/$name" "$work/$name.sig" "$work/decoded-signature"; do
    if [[ -e "$file" ]]; then unlink -- "$file"; fi
  done
  rmdir -- "$work"
}
trap cleanup EXIT
cp -- "$archive" "$work/$name"
actual="$(sha256sum < "$work/$name")"
[[ "${actual%% *}" == "$digest" ]] || { echo 'Installer does not match the qualified SHA-256.' >&2; exit 1; }
# The Tauri sidecar is a small, canonical base64 string. Bound reads and
# refuse appended data before exposing anything to the workflow inputs.
head -c 4097 -- "$signature" | base64 -d > "$work/decoded-signature"
encoded="$(base64 -w0 < "$work/decoded-signature")"
if [[ ${#encoded} -ge 4096 ]] || ! printf '%s' "$encoded" | cmp -s -- - "$signature"; then
  echo 'Expected a canonical public Tauri signature.' >&2
  exit 1
fi
mapfile -t lines < "$work/decoded-signature"
if (( ${#lines[@]} != 4 )) ||
   [[ ${lines[0]} != 'untrusted comment: signature from tauri secret key' ||
      ! ${lines[1]} =~ ^[A-Za-z0-9+/]{99}=$ || ! ${lines[3]} =~ ^[A-Za-z0-9+/]{86}==$ ]] ||
   ! printf '%s\n' "${lines[@]}" | cmp -s -- - "$work/decoded-signature"; then
  echo 'Refusing a sidecar with unexpected comments or extra data.' >&2
  exit 1
fi
printf '%s' "$encoded" > "$work/$name.sig"
key="${HOME:?Set HOME to the publisher home directory}/.config/git-khronos-signing/git-khronos.key.pub"
bash "$tools/verify-signed-debian-installer.sh" "$tag" "$work/$name" "$key"

jq -nc --arg tag "$tag" --arg run "$run" --rawfile signature "$work/$name.sig" \
  '{release_tag:$tag,candidate_run_id:$run,signature:$signature,hosted_signing:"false",verification_only:"false"}' |
  gh workflow run publish-signed-debian.yml --repo github.com/Git-Khronos/Git-Khronos --ref main --json
printf 'Submitted %s for protected publication; review and approve the release workflow on GitHub.\n' "$tag"
