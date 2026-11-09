#!/bin/bash
set -euo pipefail
export LC_ALL=C

# APT's documented Pre-Install-Pkgs VERSION 2 protocol describes the actual
# transaction before dpkg runs. Never execute or echo configuration values;
# they may contain credentials. This is not a parser for human simulation text.
refuse() {
  printf 'Git Khronos: refusing package transition: %s\n' "$1" >&2
  exit 1
}

IFS= read -r header || refuse "missing APT transaction header."
[[ "$header" == 'VERSION 2' ]] || refuse "unsupported APT transaction protocol."

configuration_complete=false
while IFS= read -r line; do
  if [[ -z "$line" ]]; then
    configuration_complete=true
    break
  fi
  [[ "$line" == *=* ]] || refuse "malformed APT configuration frame."
done
[[ "$configuration_complete" == true ]] || refuse "incomplete APT configuration frame."

saw_application=false
while IFS= read -r line; do
  [[ -n "$line" ]] || refuse "empty APT action record."
  # The final variable receives the entire filename, including spaces.
  IFS=' ' read -r package old_version direction new_version action <<< "$line"
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || refuse "invalid package name in APT action."
  [[ "$old_version" =~ ^[-+:.~A-Za-z0-9]+$ && "$new_version" =~ ^[-+:.~A-Za-z0-9]+$ ]] \
    || refuse "invalid version in APT action."
  case "$direction" in '<'|'='|'>') ;; *) refuse "invalid APT version direction." ;; esac
  case "$action" in
    '**REMOVE**')
      [[ "$package" == git-khronos-desktop ]] \
        || refuse "APT also proposes removing ${package}; no package changes were authorized by this guard."
      ;;
    '**CONFIGURE**'|/*.deb)
      if [[ "$package" == git-khronos ]]; then saw_application=true; fi
      ;;
    *) refuse "unsupported or malformed APT action." ;;
  esac
done
[[ -z "${line:-}" ]] || refuse "truncated APT action record."
[[ "$saw_application" == true ]] || refuse "transaction does not install or configure git-khronos."
