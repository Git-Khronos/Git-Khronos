#!/usr/bin/env bash
# Read-only preflight for the official GitHub publication configuration.
set -euo pipefail
hosted=false
if [[ ${1:-} == --hosted ]]; then
  hosted=true
  shift
fi
tag=${1:-}
if (( $# > 1 )) || { (( $# == 1 )) && [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }; then
  echo 'Usage: bash tools/check-hosted-debian-release.sh [--hosted] [vMAJOR.MINOR.PATCH]' >&2
  exit 2
fi

root=repos/Git-Khronos/Git-Khronos
ready=true
missing() { printf 'Not confirmed: %s\n' "$1"; ready=false; }
for tool in gh jq node; do
  command -v "$tool" >/dev/null || { printf 'Missing preflight tool: %s\n' "$tool" >&2; exit 2; }
done
get() { gh api --hostname github.com --method GET "$1"; }
# jq 1.6 can return success for empty input even with -e. Slurp and require
# exactly one response so a successful HTTP command with no JSON fails closed.
one_json() { jq -se "$@"; }

if latest=$(get "$root/releases/latest" 2>/dev/null | one_json -r 'if length == 1 then .[0].tag_name | select(type == "string" and test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) else null end') && [[ -n "$latest" ]]; then
  printf 'Latest public release: %s\n' "$latest"
else
  missing 'latest public release (missing or unreadable)'
fi

# A configured environment does not make a workflow on dev dispatchable.
# GitHub registers workflow names and paths from the default branch.
check_workflow() {
  local file=$1 name=$2
  if get "$root/actions/workflows/$file" 2>/dev/null |
     one_json --arg path ".github/workflows/$file" --arg name "$name"        'length == 1 and (.[0] | .path == $path and .name == $name and .state == "active")' >/dev/null; then
    printf 'Hosted workflow: %s is registered and active.\n' "$name"
  else
    missing "hosted workflow $name (merge the updated workflow into main and verify it is active)"
  fi
}

check_workflow release.yml 'Qualify Debian release candidate'
check_workflow publish-signed-debian.yml 'Publish signed Debian release'

if [[ -n "$tag" ]]; then
  if get "$root/git/ref/tags/$tag" 2>/dev/null |
     one_json --arg ref "refs/tags/$tag" 'length == 1 and (.[0] | .ref == $ref and (.object.type == "tag" or .object.type == "commit"))' >/dev/null; then
    printf 'Requested tag exists: %s (not a qualification result).\n' "$tag"
  else
    missing "requested tag $tag (missing or unreadable)"
  fi
fi

if publisher=$(get "$root/actions/variables/GIT_KHRONOS_UPDATER_PUBLIC_KEY" 2>/dev/null | one_json -r 'if length == 1 then .[0].value | strings else null end') &&
   GIT_KHRONOS_UPDATER_PUBLIC_KEY="$publisher" node "$(dirname -- "${BASH_SOURCE[0]}")/check-debian-update-evidence.mjs" --check-publisher-key >/dev/null 2>&1; then
  echo 'Publisher key: configured and format checked (compare with the trusted publisher copy).'
else
  missing 'publisher public key (missing, malformed, or unreadable)'
fi
unset publisher

check_environment() {
  local name=$1 environment="$root/environments/$1" policy
  if ! policy=$(get "$environment" 2>/dev/null) ||
     ! one_json --arg name "$name" 'length == 1 and .[0].name == $name' >/dev/null <<<"$policy"; then
    missing "$name environment (missing or unreadable)"
    return
  fi
  if jq -e 'any(.protection_rules[]?; .type == "required_reviewers" and (.reviewers | type == "array" and length > 0))' >/dev/null <<<"$policy"; then
    printf '%s environment: required reviewers configured.\n' "$name"
  else
    missing "required reviewers for $name"
  fi
  if jq -e '.deployment_branch_policy.custom_branch_policies == true and .deployment_branch_policy.protected_branches == false' >/dev/null <<<"$policy" &&
     get "$environment/deployment-branch-policies?per_page=2" 2>/dev/null |
       one_json 'length == 1 and (.[0] | .total_count == 1 and (.branch_policies | type == "array" and length == 1) and
         .branch_policies[0].name == "main" and .branch_policies[0].type == "branch")' >/dev/null; then
    printf '%s environment: exactly one branch rule for main.\n' "$name"
  else
    missing "main-only release environment policy for $name (inspect branch and tag rules in GitHub settings)"
  fi
}

check_environment signed-release

if [[ "$hosted" == true ]]; then
  if get "$root/contents/.github/workflows/publish-signed-debian.yml?ref=main" 2>/dev/null |
      node --input-type=module -e '
        import fs from "node:fs";
        try {
          const file = JSON.parse(fs.readFileSync(0, "utf8"));
          if (file.path !== ".github/workflows/publish-signed-debian.yml" || file.encoding !== "base64") process.exit(1);
          const workflow = Buffer.from(file.content, "base64").toString("utf8");
          if (!/^ {6}hosted_signing:\s*$/m.test(workflow) ||
              !/^ {4}environment: signed-release-signer\s*$/m.test(workflow)) process.exit(1);
        } catch { process.exit(1); }
      '; then
    echo 'Hosted signing workflow: present on main.'
  else
    missing 'hosted signing workflow on main (missing, unreadable, or not merged)'
  fi
  check_environment signed-release-signer
  if get "$root/actions/variables/GIT_KHRONOS_HOSTED_SIGNING_ENABLED" 2>/dev/null |
      one_json 'length == 1 and .[0].value == "true"' >/dev/null; then
    echo 'Hosted signing switch: enabled.'
  else
    missing 'hosted signing switch'
  fi
  if get "$root/environments/signed-release-signer/secrets/TAURI_SIGNING_PRIVATE_KEY" 2>/dev/null |
      one_json 'length == 1 and .[0].name == "TAURI_SIGNING_PRIVATE_KEY"' >/dev/null; then
    echo 'Signer key secret: metadata confirmed (not read or tested).'
  else
    missing 'signer key secret metadata (missing or unreadable)'
  fi
fi

if get "$root/actions/variables/GIT_KHRONOS_SIGNED_PUBLICATION_ENABLED" 2>/dev/null |
    one_json 'length == 1 and .[0].value == "true"' >/dev/null; then
  echo 'Signed publication switch: enabled.'
else
  missing 'signed publication switch (dry-run staging does not need it)'
fi

echo 'Read-only check: does not qualify a tag, verify signatures, or publish.'
[[ $ready == true ]]
