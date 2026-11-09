#!/usr/bin/env bash
# Git Khronos installer for Debian and Ubuntu.
#
# Downloads a published Git Khronos Debian package from GitHub Releases,
# verifies its SHA-256 checksum, and installs it with APT. A local package or a
# source build can be used instead. Run with --help for every option.
set -euo pipefail

readonly package_name="git-khronos"
readonly legacy_package_name="git-khronos-desktop"
readonly repository="Git-Khronos/Git-Khronos"
readonly checksum_asset="SHA256SUMS"
release_base_url="${GIT_KHRONOS_RELEASE_BASE_URL:-https://github.com/${repository}/releases}"
readonly release_base_url

action="install"
version=""
local_package=""
source_ref=""
dry_run=false
assume_yes=false
work_directory=""

usage() {
  cat <<EOF
Usage: install.sh [options]

Install Git Khronos system-wide on Debian or Ubuntu.

Options:
  --version VERSION   Install a specific release (for example 0.1.0).
                      Defaults to the latest published release.
  --deb FILE          Install a Debian package that is already on this machine.
  --from-source [REF] Build from source (default branch unless REF is given)
                      and install the result. Requires the development
                      toolchain described in the README.
  --uninstall         Remove the Git Khronos package. Repositories and user
                      preferences are kept.
  --dry-run           Download and verify, then show APT's plan without
                      changing the system.
  -y, --yes           Let APT proceed without asking for confirmation.
  -h, --help          Show this help.

Environment:
  GIT_KHRONOS_RELEASE_BASE_URL  Alternative release location with the same
                                layout as ${release_base_url}.
EOF
}

say() { printf '==> %s\n' "$*" >&2; }

fail() {
  printf 'Git Khronos installer: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$work_directory" ]]; then
    rm -rf -- "$work_directory"
  fi
}
trap cleanup EXIT

parse_arguments() {
  while (($#)); do
    case "$1" in
      --version)
        (($# >= 2)) || fail "--version requires a value."
        version="${2#v}"
        shift 2
        ;;
      --deb)
        (($# >= 2)) || fail "--deb requires a file path."
        local_package="$2"
        shift 2
        ;;
      --from-source)
        action="source"
        if (($# >= 2)) && [[ "$2" != -* ]]; then
          source_ref="$2"
          shift
        fi
        shift
        ;;
      --uninstall) action="uninstall"; shift ;;
      --dry-run) dry_run=true; shift ;;
      -y|--yes) assume_yes=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown option '$1'. Run with --help for usage." ;;
    esac
  done
  if [[ -n "$local_package" && ( -n "$version" || "$action" != "install" ) ]]; then
    fail "--deb cannot be combined with --version, --from-source, or --uninstall."
  fi
  if [[ -n "$version" && "$action" != "install" ]]; then
    fail "--version cannot be combined with --from-source or --uninstall."
  fi
  if [[ -n "$version" && ! "$version" =~ ^[0-9A-Za-z.+~-]+$ ]]; then
    fail "'${version}' is not a valid version."
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

check_system() {
  [[ "$(uname -s)" == "Linux" ]] || fail "this installer supports Linux only."
  require_command apt-get "apt-get was not found. This installer supports Debian and Ubuntu."
  require_command dpkg "dpkg was not found. This installer supports Debian and Ubuntu."
  if [[ -r /etc/os-release ]]; then
    local id="" id_like=""
    # shellcheck disable=SC1091
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
    # shellcheck disable=SC1091
    id_like="$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")"
    case " ${id} ${id_like} " in
      *" ubuntu "*|*" debian "*) ;;
      *) say "Warning: ${id:-this distribution} is not Debian or Ubuntu; continuing because APT is available." ;;
    esac
  fi
}

run_as_root() {
  if [[ "$dry_run" == true ]]; then
    "$@"
  elif ((EUID == 0)); then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -- "$@"
  else
    fail "administrator access is required, but sudo was not found. Run this script as root."
  fi
}

package_status() {
  dpkg-query --show --showformat='${db:Status-Status}' "$1" 2>/dev/null || true
}

is_present() {
  case "$(package_status "$1")" in
    installed|unpacked|half-installed|half-configured|triggers-awaited|triggers-pending) return 0 ;;
    *) return 1 ;;
  esac
}

download() {
  local url="$1" destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --proto '=https,file' --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    [[ "$url" == https://* ]] || fail "wget can only download HTTPS URLs; install curl to use ${url}."
    wget --quiet --https-only --output-document="$destination" "$url"
  else
    fail "curl or wget is required to download Git Khronos."
  fi
}

release_url() {
  if [[ -n "$version" ]]; then
    printf '%s/download/v%s/%s\n' "$release_base_url" "$version" "$1"
  else
    printf '%s/latest/download/%s\n' "$release_base_url" "$1"
  fi
}

download_release_package() {
  local architecture sums asset expected actual
  architecture="$(dpkg --print-architecture)"
  sums="${work_directory}/${checksum_asset}"
  say "Looking up the ${version:-latest} Git Khronos release"
  download "$(release_url "$checksum_asset")" "$sums" \
    || fail "no published release was found at ${release_base_url}. Use --from-source to build it, or --deb with a package you already have."

  asset="$(awk -v arch="$architecture" '
    $2 ~ "^\\*?Git-Khronos_[^/]+_" arch "\\.deb$" { sub(/^\*/, "", $2); print $2; exit }
  ' "$sums")"
  [[ -n "$asset" ]] || fail "the release does not provide a Debian package for ${architecture}."
  expected="$(awk -v name="$asset" '{ file = $2; sub(/^\*/, "", file) } file == name { print $1; exit }' "$sums")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "the release checksum for ${asset} is malformed."

  say "Downloading ${asset}"
  download "$(release_url "$asset")" "${work_directory}/${asset}" || fail "could not download ${asset}."
  actual="$(sha256sum -- "${work_directory}/${asset}" | awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] \
    || fail "checksum mismatch for ${asset} (expected ${expected}, got ${actual}). The download was discarded."
  say "Verified SHA-256 ${actual}"
  printf '%s\n' "${work_directory}/${asset}"
}

verify_package_identity() {
  local package_file="$1" name architecture system_architecture
  [[ -f "$package_file" ]] || fail "package not found: ${package_file}"
  name="$(dpkg-deb --field "$package_file" Package 2>/dev/null)" \
    || fail "${package_file} is not a readable Debian package."
  [[ "$name" == "$package_name" ]] || fail "${package_file} contains '${name}', not ${package_name}."
  architecture="$(dpkg-deb --field "$package_file" Architecture)"
  system_architecture="$(dpkg --print-architecture)"
  [[ "$architecture" == "$system_architecture" || "$architecture" == "all" ]] \
    || fail "${package_file} targets ${architecture}, but this system is ${system_architecture}."
}

install_package_file() {
  local package_file="$1" absolute
  verify_package_identity "$package_file"
  absolute="$(cd -- "$(dirname -- "$package_file")" && pwd)/$(basename -- "$package_file")"
  if is_present "$legacy_package_name"; then
    fail "the older ${legacy_package_name} package is installed. Remove it first with 'sudo apt-get remove ${legacy_package_name}', then run this installer again."
  fi
  local options=(install --reinstall --no-remove)
  [[ "$assume_yes" == true ]] && options+=(--yes)
  if [[ "$dry_run" == true ]]; then
    say "Dry run: APT would perform the following (nothing is changed)"
    apt-get "${options[@]}" --simulate "$absolute"
    return
  fi
  say "Installing $(dpkg-deb --field "$absolute" Version) with APT (administrator access required)"
  run_as_root apt-get "${options[@]}" "$absolute"
  printf '\nGit Khronos is installed. Open it from the application menu or run git-khronos.\n'
}

install_from_source() {
  require_command git "Git is required to build from source."
  require_command task "Task (taskfile.dev) is required to build from source; see the README's development setup."
  local checkout="${work_directory}/source"
  say "Cloning ${repository}${source_ref:+ at ${source_ref}}"
  git clone --quiet --depth 1 ${source_ref:+--branch "$source_ref"} "https://github.com/${repository}.git" "$checkout"
  say "Installing build dependencies and building the Debian package"
  (cd "$checkout" && task install && task package:deb)
  install_package_file "$(cd "$checkout" && task --silent package:deb:path | tail -n 1)"
}

uninstall() {
  if ! is_present "$package_name"; then
    say "Git Khronos is not installed as a Debian package."
    return
  fi
  if [[ "$dry_run" == true ]]; then
    apt-get remove --simulate "$package_name"
    return
  fi
  say "Removing Git Khronos. Repositories and user preferences are kept."
  local options=(remove)
  [[ "$assume_yes" == true ]] && options+=(--yes)
  run_as_root apt-get "${options[@]}" "$package_name"
}

main() {
  parse_arguments "$@"
  check_system
  work_directory="$(mktemp -d -t git-khronos-install.XXXXXX)"
  case "$action" in
    uninstall) uninstall ;;
    source) install_from_source ;;
    install)
      if [[ -n "$local_package" ]]; then
        install_package_file "$local_package"
      else
        local downloaded
        downloaded="$(download_release_package)"
        install_package_file "$downloaded"
      fi
      ;;
  esac
}

main "$@"
