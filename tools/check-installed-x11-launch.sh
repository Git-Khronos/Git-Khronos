#!/usr/bin/env bash
# Probe both installed launch paths without using the user's desktop or app state.
set -euo pipefail

probe_usage() {
  printf '%s\n' \
    'Usage: bash tools/check-installed-x11-launch.sh [PACKAGE.deb | --renderer-recovery PACKAGE.deb]' \
    'Run as an unprivileged user after installing the reviewed package.' \
    'Requires python3, Xvfb, xauth, dbus-run-session, gio, and timeout. With PACKAGE.deb, also requires Node.' \
    'Set GIT_KHRONOS_ACCEPTANCE_PYTHON to an absolute interpreter path if python3 is unavailable.' \
    'Renderer recovery also requires libXtst to verify the replacement renderer responds to input.' \
    'Without an archive, checks desktop-entry and command launch but does not verify installed bytes.' \
    'This checks X11 rendering, not a host-specific pinned shortcut or WSLg.'
}

if (( $# == 1 )) && [[ $1 == --help || $1 == -h ]]; then
  probe_usage
  exit 0
fi

modes=(desktop command)
limit=50
if [[ ${1:-} == --renderer-recovery && $# == 2 ]]; then
  modes=(renderer-recovery)
  limit=90
  shift
fi
if (( $# > 1 || EUID == 0 )) || [[ ${1:-} == --renderer-recovery ]]; then
  probe_usage >&2
  exit 2
fi
tools_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
require_probe_command() {
  command -v "$1" || { echo "Missing launcher probe dependency: $1" >&2; return 127; }
}
python_override=${GIT_KHRONOS_ACCEPTANCE_PYTHON:-}
if [[ -n $python_override && $python_override != /* ]]; then
  printf 'GIT_KHRONOS_ACCEPTANCE_PYTHON must be an absolute interpreter path.\n' >&2
  exit 2
fi
python="$(require_probe_command "${python_override:-python3}")"
python="$(realpath -- "$python")"
if (( $# == 1 )); then
  # Check before starting Xvfb and before replacing the caller's tool PATH.
  node="$(require_probe_command node)"
  "$node" "$tools_dir/check-installed-deb.mjs" "$1"
fi
# The desktop entry resolves a bare executable name. Do not let a developer
# build or another git-khronos earlier on the caller's PATH satisfy the probe.
export PATH=/usr/bin:/bin
for cmd in Xvfb xauth dbus-run-session gio timeout; do
  require_probe_command "$cmd" >/dev/null
done
if [[ ! -x /usr/bin/git-khronos || ! -r /usr/share/applications/git-khronos.desktop ]]; then
  echo 'The system executable or desktop entry is missing; install the reviewed .deb first.' >&2
  exit 2
fi
probe="$tools_dir/probe-installed-x11-window.py"
for mode in "${modes[@]}"; do (
  private=$(mktemp -d)
  server=
  cleanup() {
    if [[ -n "$server" ]]; then
      kill "$server" 2>/dev/null || :
      wait "$server" 2>/dev/null || :
    fi
    # The private app session is closed, but a renderer process can still
    # finish a shader-cache write while its home is being removed.
    for ((attempt = 0; attempt < 4; attempt++)); do
      rm -rf -- "$private" 2>/dev/null && return
      sleep .1
    done
    rm -rf -- "$private"
  }
  trap cleanup EXIT
  mkdir -m 700 "$private/home" "$private/runtime"
  # WSLg can mount /tmp/.X11-unix read-only. Use the Linux abstract
  # transport only, and avoid the low display numbers used by the desktop.
  # Connecting to our server requires a cookie held in the private directory.
  display=
  for ((attempt = 0; attempt < 4; attempt++)); do
    number=$((100 + RANDOM % 900))
    [[ ! -e "/tmp/.X11-unix/X$number" && ! -e "/tmp/.X$number-lock" ]] || continue
    : > "$private/authority"
    chmod 600 "$private/authority"
    cookie=$("$python" -c 'import secrets; print(secrets.token_hex(16))')
    printf 'add :%s MIT-MAGIC-COOKIE-1 %s\n' "$number" "$cookie" | xauth -q -f "$private/authority"
    Xvfb ":$number" -nolisten tcp -nolisten unix -auth "$private/authority" \
      -screen 0 1600x1000x24 -displayfd 3 3>"$private/display" 2>"$private/xvfb.log" &
    server=$!
    for ((i = 0; i < 100; i++)); do
      [[ -s "$private/display" ]] && break
      kill -0 "$server" 2>/dev/null || break
      sleep .05
    done
    if [[ $(cat "$private/display") == "$number" ]] && kill -0 "$server" 2>/dev/null; then
      display=$number
      break
    fi
    kill "$server" 2>/dev/null || :
    wait "$server" 2>/dev/null || :
    server=
  done
  if [[ -z "$display" ]]; then
    printf 'Could not start an authenticated private Xvfb display. The desktop display was not changed.\n' >&2
    if [[ -s "$private/xvfb.log" ]]; then cat "$private/xvfb.log" >&2; fi
    exit 1
  fi
  cd "$private/home"
  env -i PATH="$PATH" HOME="$PWD" XDG_RUNTIME_DIR="$private/runtime" \
    DISPLAY=":$display" XAUTHORITY="$private/authority" GDK_BACKEND=x11 timeout "${limit}s" dbus-run-session -- "$python" "$probe" "$mode"
); done
