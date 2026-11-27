#!/usr/bin/env bash
set -euo pipefail
if (( $# != 1 )) || [[ ! $1 =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Usage: check-debian-release-version.sh vMAJOR.MINOR.PATCH' >&2
  exit 2
fi
RELEASE_TAG=$1
version="${RELEASE_TAG#v}"
match_version() {
  if [[ "$2" != "$version" ]]; then
    echo "::error::$1 version $2 does not match release tag $RELEASE_TAG."
    return 1
  fi
}
project_version="$(jq -er '.version | strings' package.json)"
app_version="$(jq -er '.version | strings' apps/desktop/src-tauri/tauri.conf.json)"
changelog_version="$(dpkg-parsechangelog --file packaging/debian/changelog --show-field Version)"
match_version package.json "$project_version"
match_version tauri.conf.json "$app_version"
match_version Debian-changelog "$changelog_version"
metadata="$(cargo metadata --no-deps --format-version 1 --offline --locked)"
for crate in git-khronos-desktop git-khronos-git-core; do
  installed_version="$(jq -er --arg crate "$crate" '.packages[] | select(.name == $crate) | .version' <<<"$metadata")"
  match_version "$crate" "$installed_version"
done
printf "Release version %s matches the installer and both Rust crates.\n" "$version"
