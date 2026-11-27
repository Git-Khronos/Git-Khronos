#!/usr/bin/env bash
# Run independent installed-package suites even when a sibling test fails.
set -euo pipefail

usage() {
  echo 'Usage: bash tools/run-native-suites.sh PACKAGE SUITE[:inherited] [SUITE[:inherited] ...]'
  echo 'Tests an already installed package in temporary repositories; does not install it.'
  echo 'Set GIT_KHRONOS_NATIVE_OUTPUT to retain reports in a separate directory.'
  echo 'Set GIT_KHRONOS_ACCEPTANCE_PYTHON to an absolute interpreter path if python3 is unavailable.'
}

if (( $# == 1 )) && [[ $1 == --help || $1 == -h ]]; then
  usage
  exit 0
fi
if (( $# < 2 )); then
  usage >&2
  exit 2
fi
package=$1
shift
if [[ ! -f "$package" ]]; then
  printf 'Installed acceptance package not found: %s\n' "$package" >&2
  exit 2
fi

declare -A seen=()
suite_args=()
for lane; do
  if [[ ! "$lane" =~ ^[a-z0-9]+(-[a-z0-9]+)*(:inherited)?$ || -v "seen[$lane]" ]]; then
    printf 'Invalid or repeated native suite: %s\n' "$lane" >&2
    exit 2
  fi
  seen[$lane]=1
  suite_args+=(--suite "${lane%:inherited}")
done

runner="$(dirname -- "${BASH_SOURCE[0]}")/native_acceptance.py"
python="${GIT_KHRONOS_ACCEPTANCE_PYTHON:-python3}"
if [[ -n "${GIT_KHRONOS_ACCEPTANCE_PYTHON:-}" && "$python" != /* ]]; then
  printf 'GIT_KHRONOS_ACCEPTANCE_PYTHON must be an absolute interpreter path.\n' >&2
  exit 2
fi
if ! command -v -- "$python" >/dev/null; then
  printf 'No usable Python interpreter: %s. Put python3 on PATH or set GIT_KHRONOS_ACCEPTANCE_PYTHON.\n' "$python" >&2
  exit 127
fi
# argparse validates every --suite, even when repeated. The description
# exits before package extraction, fixture creation or WebDriver startup.
"$python" "$runner" --describe-runner "${suite_args[@]}" >/dev/null
output=()
if [[ -n ${GIT_KHRONOS_NATIVE_OUTPUT:-} ]]; then
  output=(--output "$GIT_KHRONOS_NATIVE_OUTPUT")
fi
failed=()
failed_lanes=()
passed=0
summary_rows=()
write_ci_summary() {
  local heading=$1 rows
  [[ -n ${GITHUB_STEP_SUMMARY:-} ]] || return 0
  printf -v rows '%s\n' "${summary_rows[@]}"
  if ! printf '### Installed native acceptance: %s\n\n| Suite | Result |\n| --- | --- |\n%s\n' \
    "$heading" "$rows" >> "$GITHUB_STEP_SUMMARY"; then
    printf 'Could not write the installed native acceptance step summary.\n' >&2
  fi
}
for lane; do
  suite="${lane%:inherited}"
  context=()
  if [[ "$lane" != "$suite" ]]; then context=(--inherited-git-environment); fi
  printf '\nInstalled native suite: %s\n' "$lane"
  if "$python" "$runner" --suite "$suite" --headless --installed --package "$package" "${context[@]}" "${output[@]}"; then
    passed=$((passed + 1))
    summary_rows+=("| \`${lane}\` | Passed |")
    printf 'Installed native suite passed: %s\n' "$lane"
  else
    code=$?
    printf 'Installed native suite failed: %s (exit %s)\n' "$lane" "$code" >&2
    # An interrupted or killed harness may not have finished cleanup.
    # Don't start any more suites after that.
    if (( code >= 128 )); then
      summary_rows+=("| \`${lane}\` | Interrupted (exit $code) |")
      write_ci_summary 'interrupted; remaining suites not started'
      exit "$code"
    fi
    summary_rows+=("| \`${lane}\` | Failed (exit $code) |")
    failed+=("$lane:$code")
    failed_lanes+=("$lane")
  fi
done
write_ci_summary "$passed/$# passed"
printf 'Installed native suite summary: %s/%s passed.\n' "$passed" "$#"
if (( ${#failed[@]} )); then
  printf 'Failed installed native suites (suite:exit): %s\n' "${failed[*]}" >&2
  printf 'Rerun only failed suites (from the same directory and environment):\n  bash' >&2
  printf ' %q' "${BASH_SOURCE[0]}" "$package" "${failed_lanes[@]}" >&2
  printf '\n' >&2
  exit 1
fi
