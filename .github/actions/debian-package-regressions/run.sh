#!/usr/bin/env bash
set -euo pipefail

# Private dpkg databases still read host invocation hooks. On the disposable
# runner, move these known hooks out of the way only for fixture transactions.
config=/etc/dpkg/dpkg.cfg.d
hooks=(needrestart pkg-config-hook-config pkgconf-hook-config)
backup=$(mktemp -d)
restore_hooks() {
  local status=$?
  trap - EXIT
  for hook in "${hooks[@]}"; do
    if [[ -e "$backup/$hook" || -L "$backup/$hook" ]]; then
      sudo mv -- "$backup/$hook" "$config/$hook" || status=1
    fi
  done
  if ! rmdir -- "$backup"; then
    printf 'Could not restore every dpkg hook; check %s\n' "$backup" >&2
    status=1
  fi
  exit "$status"
}
trap restore_hooks EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for hook in "${hooks[@]}"; do
  if [[ -e "$config/$hook" || -L "$config/$hook" ]]; then
    if sudo mv -- "$config/$hook" "$backup/$hook"; then
      continue
    else
      status=$?
      printf 'Could not temporarily disable dpkg hook: %s\n' "$hook" >&2
      exit "$status"
    fi
  fi
done
pnpm nx run desktop:package-test --output-style=static
