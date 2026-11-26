#!/usr/bin/env bash
# Read-only preflight for the official GitHub publication configuration.
set -euo pipefail
tag=${1:-}
if (( $# > 1 )) || { (( $# == 1 )) && [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }; then
  echo 'Usage: bash tools/check-hosted-debian-release.sh [vMAJOR.MINOR.PATCH]' >&2
  exit 2
fi

root=repos/Git-Khronos/Git-Khronos
environment="$root/environments/signed-release"
ready=true
missing() { printf 'Not confirmed: %s\n' "$1"; ready=false; }
for tool in gh jq node; do
  command -v "$tool" >/dev/null || { printf 'Missing preflight tool: %s\n' "$tool" >&2; exit 2; }
done
get() { gh api --hostname github.com --method GET "$1"; }

if latest=$(get "$root/releases/latest" 2>/dev/null | jq -er '.tag_name | select(type == "string" and test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))'); then
  printf 'Latest public release: %s\n' "$latest"
else
  missing 'latest public release (missing or unreadable)'
fi

if [[ -n "$tag" ]]; then
  if get "$root/git/ref/tags/$tag" 2>/dev/null |
     jq -e --arg ref "refs/tags/$tag" '.ref == $ref and (.object.type == "tag" or .object.type == "commit")' >/dev/null; then
    printf 'Requested tag exists: %s (not a qualification result).\n' "$tag"
  else
    missing "requested tag $tag (missing or unreadable)"
  fi
fi

if publisher=$(get "$root/actions/variables/GIT_KHRONOS_UPDATER_PUBLIC_KEY" 2>/dev/null | jq -er '.value | strings') &&
   GIT_KHRONOS_UPDATER_PUBLIC_KEY="$publisher" node "$(dirname -- "${BASH_SOURCE[0]}")/check-debian-update-evidence.mjs" --check-publisher-key >/dev/null 2>&1; then
  echo 'Publisher key: configured and format checked (compare with the trusted publisher copy).'
else
  missing 'publisher public key (missing, malformed, or unreadable)'
fi
unset publisher

if policy=$(get "$environment" 2>/dev/null) && jq -e '.name == "signed-release"' >/dev/null <<<"$policy"; then
  if jq -e 'any(.protection_rules[]?; .type == "required_reviewers" and (.reviewers | type == "array" and length > 0))' >/dev/null <<<"$policy"; then
    echo 'Release environment: required reviewers configured.'
  else
    missing 'required reviewers for signed-release'
  fi
  if jq -e '.deployment_branch_policy.custom_branch_policies == true and .deployment_branch_policy.protected_branches == false' >/dev/null <<<"$policy" &&
     get "$environment/deployment-branch-policies?per_page=2" 2>/dev/null |
       jq -e '.total_count == 1 and (.branch_policies | type == "array" and length == 1) and
         .branch_policies[0].name == "main" and .branch_policies[0].type == "branch"' >/dev/null; then
    echo 'Release environment: exactly one branch rule for main.'
  else
    missing 'main-only release environment policy (inspect branch and tag rules in GitHub settings)'
  fi
else
  missing 'signed-release environment (missing or unreadable)'
fi

if get "$root/actions/variables/GIT_KHRONOS_SIGNED_PUBLICATION_ENABLED" 2>/dev/null |
    jq -e '.value == "true"' >/dev/null; then
  echo 'Signed publication switch: enabled.'
else
  missing 'signed publication switch (dry-run staging does not need it)'
fi

echo 'Read-only check: does not qualify a tag, verify signatures, or publish.'
[[ $ready == true ]]
