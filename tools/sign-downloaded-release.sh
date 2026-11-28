#!/usr/bin/env bash
# Use only evidence retained by task release:download; never select a local build.
set +x
set -euo pipefail
if (( $# > 1 )); then
  echo 'Usage: task sign [-- TAG | QUALIFIED_RELEASE_DIRECTORY]' >&2
  exit 2
fi
pattern='^([a-f0-9]{64})  (Git-Khronos_((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))_amd64\.deb)$'
tag_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
requested_tag=
if (( $# == 1 )) && [[ ! "$1" =~ $tag_pattern ]]; then
  directory=$1
else
  requested_tag=${1:-}
  shopt -s nullglob
  receipts=(target/local-review/hosted-release-integration/*/*/qualified-package.sha256)
  unsigned=()
  for candidate in "${receipts[@]}"; do
    candidate_tag=
    if [[ -f "$candidate" && ! -L "$candidate" ]]; then
      entry=$(<"$candidate")
      if [[ "$entry" =~ $pattern ]]; then
        candidate_tag="v${BASH_REMATCH[3]}"
        sidecar="${candidate%/*}/candidate/${BASH_REMATCH[2]}.sig"
        [[ ! -e "$sidecar" && ! -L "$sidecar" ]] || continue
      fi
    fi
    # An explicit tag only considers candidates whose receipt names that tag.
    # Without a filter, malformed records remain visible to strict validation.
    [[ -z "$requested_tag" || "$candidate_tag" == "$requested_tag" ]] || continue
    unsigned+=("$candidate")
  done
  if (( ${#unsigned[@]} == 0 )); then
    printf 'No unsigned qualified release found%s. Download a qualified candidate with task release:download first.\n' "${requested_tag:+ for $requested_tag}" >&2
    exit 2
  elif (( ${#unsigned[@]} > 1 )); then
    echo 'Expected exactly one unsigned qualified download. Use task sign -- TAG or select a specific QUALIFIED_RELEASE_DIRECTORY.' >&2
    exit 2
  fi
  directory=${unsigned[0]%/*}
fi
receipt="$directory/qualified-package.sha256"
[[ -f "$receipt" && ! -L "$receipt" ]] || { echo 'Missing qualified-package.sha256; run task release:download first.' >&2; exit 2; }
entry=$(<"$receipt")
[[ "$entry" =~ $pattern ]] || { echo 'Invalid qualified package checksum record.' >&2; exit 2; }
digest=${BASH_REMATCH[1]}
package="$directory/candidate/${BASH_REMATCH[2]}"
tag="v${BASH_REMATCH[3]}"
key="${HOME:?Set HOME to the publisher home directory}/.config/git-khronos-signing/git-khronos.key"
actual=$(node tools/check-debian-update-evidence.mjs --release-package "$package" \
  "$directory/candidate/build-receipt.json" "$directory/candidate-evidence/report.json" "$key.pub")
[[ "$actual" == "$digest" ]] || { echo 'Qualification evidence and saved checksum disagree.' >&2; exit 1; }
node tools/report-installed-acceptance.mjs --verify-release "$directory/candidate/build-receipt.json" \
  "$key.pub" "$package" --reports-dir "$directory/candidate-matrix" >/dev/null
bash tools/sign-qualified-debian.sh --prompt "$key" "$package" "$digest" "$tag"
printf 'Public signature: %s\n' "$package.sig"
