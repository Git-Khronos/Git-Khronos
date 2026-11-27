#!/usr/bin/env bash
# Read-only GitHub handoff. Never takes a private signing key or signs a file.
set -euo pipefail
if (( $# != 4 )) || [[ ! "$1" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ || ! "$2" =~ ^[1-9][0-9]{0,15}$ ]]; then
  echo 'Usage: bash tools/download-qualified-debian.sh TAG RUN-ID PUBLIC-KEY OUTPUT-PARENT' >&2
  exit 2
fi
tag=$1 run=$2
public_key=$3
parent=$4
repo=Git-Khronos/Git-Khronos
tools="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "$parent" == -* || ! -d "$parent" || ! -f "$public_key" || ! -r "$public_key" ]]; then
  echo 'Provide a readable publisher public key and an existing output directory.' >&2
  exit 2
fi
parent="$(cd -- "$parent" && pwd -P)"
for cmd in gh git node; do command -v "$cmd" >/dev/null; done

# Refuse pending/failed attempts before allocating a persistent destination.
umask 077
run_json="$(mktemp)"
trap 'unlink -- "$run_json"' EXIT
gh api --hostname github.com "repos/$repo/actions/runs/$run" > "$run_json"
selection="$(node "$tools/check-debian-candidate-run.mjs" "$run_json" "$run")"
read -r _ attempt <<< "$selection"
tag_refs="$(git ls-remote --exit-code "https://github.com/$repo.git" "refs/tags/$tag" "refs/tags/$tag^{}")"
commit="$(awk -v ref="refs/tags/$tag" '$2 == ref { raw=$1 } $2 == ref "^{}" { peeled=$1 } END { print peeled ? peeled : raw }' <<< "$tag_refs")"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]

work="$(mktemp -d "$parent/$tag-run-$run-attempt-$attempt.XXXXXX")"
trap 'printf "Qualification did not verify; retained evidence in %s. Do not sign it.\n" "$work" >&2' ERR
cp -- "$run_json" "$work/candidate-run.json"
download=(gh run download "$run" --repo "github.com/$repo")
"${download[@]}" --name "debian-candidate-$attempt" --dir "$work/candidate" >&2
node "$tools/check-debian-candidate-run.mjs" "$work/candidate-run.json" "$run" \
  "$work/candidate/candidate.json" "$tag" "$commit"
"${download[@]}" --name "debian-candidate-evidence-$attempt" --dir "$work/candidate-evidence" >&2
"${download[@]}" --pattern "debian-runtime-reports-$attempt-*" --dir "$work/candidate-matrix" >&2
receipt="$work/candidate/build-receipt.json"
package="$work/candidate/Git-Khronos_${tag#v}_amd64.deb"
digest="$(node "$tools/check-debian-update-evidence.mjs" --release-package "$package" \
  "$receipt" "$work/candidate-evidence/report.json" "$public_key")"
node "$tools/report-installed-acceptance.mjs" --verify-release "$receipt" "$public_key" \
  "$package" --reports-dir "$work/candidate-matrix" > "$work/installed-release-matrix.json"
printf '%s  %s\n' "$digest" "${package##*/}" > "$work/qualified-package.sha256"
trap - ERR
printf 'Verified package: %s\nQualified SHA-256: %s\n' "$package" "$digest"
