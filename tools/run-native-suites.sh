#!/usr/bin/env bash
# Run independent installed-package suites even when a sibling test fails.
set -euo pipefail

if (( $# < 2 )); then
  echo 'Usage: bash tools/run-native-suites.sh PACKAGE SUITE [SUITE ...]' >&2
  exit 2
fi
package=$1
shift
if [[ ! -f "$package" ]]; then
  printf 'Installed acceptance package not found: %s\n' "$package" >&2
  exit 2
fi

declare -A seen=()
for suite; do
  if [[ ! "$suite" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ || -v "seen[$suite]" ]]; then
    printf 'Invalid or repeated native suite: %s\n' "$suite" >&2
    exit 2
  fi
  seen[$suite]=1
done

runner="$(dirname -- "${BASH_SOURCE[0]}")/native_acceptance.py"
output=()
if [[ -n ${GIT_KHRONOS_NATIVE_OUTPUT:-} ]]; then
  output=(--output "$GIT_KHRONOS_NATIVE_OUTPUT")
fi
failed=()
for suite; do
  printf '\nInstalled native suite: %s\n' "$suite"
  if python3 "$runner" --suite "$suite" --headless --installed --package "$package" "${output[@]}"; then
    printf 'Installed native suite passed: %s\n' "$suite"
  else
    code=$?
    printf 'Installed native suite failed: %s (exit %s)\n' "$suite" "$code" >&2
    # An interrupted or killed harness may not have finished cleanup.
    # Don't start any more suites after that.
    if (( code >= 128 )); then
      exit "$code"
    fi
    failed+=("$suite:$code")
  fi
done
if (( ${#failed[@]} )); then
  printf 'Failed installed native suites (suite:exit): %s\n' "${failed[*]}" >&2
  exit 1
fi
