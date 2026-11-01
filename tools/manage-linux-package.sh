#!/usr/bin/env bash
set -euo pipefail

readonly package_name="git-khronos"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
repository_root="$(cd -- "${script_dir}/.." && pwd)"
readonly repository_root
case "${CARGO_TARGET_DIR:-}" in
  '') cargo_target_directory="${repository_root}/target" ;;
  /*) cargo_target_directory="$CARGO_TARGET_DIR" ;;
  *) cargo_target_directory="${PWD}/${CARGO_TARGET_DIR}" ;;
esac
readonly cargo_target_directory
readonly package_directory="${cargo_target_directory}/release/bundle/deb"

fail() {
  printf 'Git Khronos: %s\n' "$1" >&2
  exit 1
}

require_package_tools() {
  [[ "$(uname -s)" == "Linux" ]] || fail "system package installation is currently supported on Linux only."
  command -v dpkg-deb >/dev/null 2>&1 || fail "dpkg-deb was not found. Install the Debian package tools and try again."
  # dpkg-deb also extracts control metadata when reading fields. Keep that
  # temporary work beside the build outputs unless the caller chose TMPDIR.
  if [[ -z "${TMPDIR:-}" ]]; then
    TMPDIR="${repository_root}/target/package-tmp"
    mkdir -p -- "$TMPDIR"
    export TMPDIR
  fi
}

require_apt() {
  command -v apt-get >/dev/null 2>&1 || fail "apt-get was not found. Installation currently supports Debian and Ubuntu systems."
}

run_as_root() {
  if (( EUID == 0 )); then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -- "$@"
  else
    fail "administrator access is required, but sudo was not found. Run this task as root or install sudo."
  fi
}

latest_package() {
  local candidate selected=""
  shopt -s nullglob
  local candidates=("${package_directory}"/*.deb)
  shopt -u nullglob

  for candidate in "${candidates[@]}"; do
    if [[ "$(dpkg-deb --field "$candidate" Package 2>/dev/null)" == "$package_name" ]] \
      && { [[ -z "$selected" ]] || [[ "$candidate" -nt "$selected" ]]; }; then
      selected="$candidate"
    fi
  done

  [[ -n "$selected" ]] || fail "no ${package_name} Debian package was found in ${package_directory}. Run 'task package:deb' first."
  printf '%s\n' "$selected"
}

package_field() {
  dpkg-deb --field "$1" "$2" 2>/dev/null
}

name_package() {
  local package_file destination
  package_file="$(latest_package)"
  destination="${package_directory}/Git-Khronos_$(package_field "$package_file" Version)_$(package_field "$package_file" Architecture).deb"
  if [[ "$package_file" != "$destination" ]]; then
    mv -- "$package_file" "$destination"
  fi
  printf '%s\n' "$destination"
}

require_package_field() {
  local package_file="$1" field="$2" expected="$3" actual
  actual="$(package_field "$package_file" "$field")"
  [[ "$actual" == "$expected" ]] || fail "package field ${field} is '${actual}', expected '${expected}'."
}

require_desktop_field() {
  local desktop_file="$1" expected_key="$2" expected_value="$3" key value
  while IFS='=' read -r key value; do
    if [[ "$key" == "$expected_key" ]]; then
      [[ "$value" == "$expected_value" ]] \
        || fail "desktop entry ${expected_key} is '${value}', expected '${expected_value}'."
      return
    fi
  done < "$desktop_file"
  fail "desktop entry is missing ${expected_key}."
}

verify_package() {
  local package_file="${1:-}" extracted depends temporary_directory cleanup_command
  [[ -n "$package_file" ]] || package_file="$(latest_package)"
  [[ -f "$package_file" ]] || fail "package does not exist: ${package_file}"

  require_package_field "$package_file" Package "$package_name"
  require_package_field "$package_file" Conflicts "git-khronos-desktop"
  require_package_field "$package_file" Replaces "git-khronos-desktop"
  require_package_field "$package_file" Section "vcs"
  [[ -n "$(package_field "$package_file" Version)" ]] || fail "package version is empty."
  [[ -n "$(package_field "$package_file" Architecture)" ]] || fail "package architecture is empty."
  depends="$(package_field "$package_file" Depends)"
  [[ "$depends" == *"git (>= 1:2.39)"* ]] || fail "package does not require Git 2.39 or newer."
  [[ "$depends" == *"libwebkit2gtk-4.1-0"* ]] || fail "package does not declare the WebKitGTK runtime."
  [[ "$depends" == *"libgtk-3-0"* ]] || fail "package does not declare the GTK runtime."

  temporary_directory="$(mktemp -d -t git-khronos-package.XXXXXX)"
  # Preserve the owned path even if a failing extractor unwinds local scope.
  printf -v cleanup_command 'rm -rf -- %q' "$temporary_directory"
  trap "$cleanup_command" EXIT
  dpkg-deb --extract "$package_file" "$temporary_directory"
  extracted="${temporary_directory}/usr"

  [[ -x "${extracted}/bin/git-khronos" ]] || fail "package executable is missing or is not executable."
  [[ ! -e "${extracted}/bin/git-khronos-desktop" ]] || fail "package contains the obsolete git-khronos-desktop executable."
  [[ ! -e "${extracted}/bin/export-ipc" ]] || fail "package contains the development-only export-ipc executable."
  local required_file
  for required_file in \
    "share/applications/Git Khronos.desktop" \
    "share/icons/hicolor/32x32/apps/git-khronos.png" \
    "share/icons/hicolor/128x128/apps/git-khronos.png" \
    "share/icons/hicolor/256x256@2/apps/git-khronos.png" \
    "share/doc/git-khronos/copyright" \
    "share/doc/git-khronos/THIRD_PARTY_NOTICES.md" \
    "share/doc/git-khronos/rust-dependency-notices.json.gz" \
    "share/doc/git-khronos/frontend-dependency-notices.txt.gz" \
    "share/doc/git-khronos/changelog.gz" \
    "share/man/man1/git-khronos.1.gz"; do
    [[ -s "${extracted}/${required_file}" ]] || fail "package payload is missing /usr/${required_file}."
  done

  local desktop_file="${extracted}/share/applications/Git Khronos.desktop"
  require_desktop_field "$desktop_file" Type "Application"
  require_desktop_field "$desktop_file" Name "Git Khronos"
  require_desktop_field "$desktop_file" Exec "git-khronos %U"
  require_desktop_field "$desktop_file" MimeType "x-scheme-handler/git-khronos;"
  require_desktop_field "$desktop_file" Icon "git-khronos"
  require_desktop_field "$desktop_file" StartupWMClass "git-khronos"
  gzip --test "${extracted}/share/doc/git-khronos/changelog.gz"
  gzip --test "${extracted}/share/man/man1/git-khronos.1.gz"
  local notice_payload="share/doc/git-khronos/rust-dependency-notices.json.gz"
  local expected_notices="${repository_root}/target/package-assets/rust-dependency-notices.json.gz"
  gzip --test "${extracted}/${notice_payload}"
  [[ -s "$expected_notices" ]] || fail "generated Rust notices are missing; rebuild with 'task package:deb'."
  cmp -s -- "$expected_notices" "${extracted}/${notice_payload}" \
    || fail "packaged Rust notices differ from the generated catalog; rebuild with 'task package:deb'."
  notice_payload="share/doc/git-khronos/frontend-dependency-notices.txt.gz"
  expected_notices="${repository_root}/target/package-assets/frontend-dependency-notices.txt.gz"
  gzip --test "${extracted}/${notice_payload}"
  [[ -s "$expected_notices" ]] || fail "generated frontend notices are missing; rebuild with 'task package:deb'."
  cmp -s -- "$expected_notices" "${extracted}/${notice_payload}" \
    || fail "packaged frontend notices differ from the generated notices; rebuild with 'task package:deb'."

  trap - EXIT
  rm -rf -- "$temporary_directory"
  printf 'Verified Debian package:\n  %s\n' "$package_file"
}

print_package() {
  local package_file
  package_file="$(latest_package)"
  # Task's build cache must reject broken payloads, not just unreadable headers.
  verify_package "$package_file" >/dev/null
  printf '%s\n' "$package_file"
}

install_package() {
  local package_file legacy_status transition_directory guard cleanup_command
  package_file="$(latest_package)"
  verify_package "$package_file"
  require_apt
  printf 'Installing %s system-wide from:\n  %s\n' "$package_name" "$package_file"
  legacy_status="$(dpkg-query --show --showformat='${db:Status-Status}' git-khronos-desktop 2>/dev/null || true)"
  case "$legacy_status" in
    installed|unpacked|half-installed|half-configured|triggers-awaited|triggers-pending)
      [[ -x "${script_dir}/guard-linux-package-transition.sh" ]] \
        || fail "the legacy replacement guard is missing or is not executable."
      # A unique command path prevents protocol options from changing any of
      # the machine's existing APT hooks. /tmp gives this command a space-free
      # path even when the checkout or TMPDIR contains spaces. The symlink's
      # executable target remains the reviewed repository script.
      transition_directory="$(mktemp -d /tmp/git-khronos-apt-guard.XXXXXX)"
      # Capture the validated mktemp path now: local variables may no longer
      # exist when an error unwinds the function before its EXIT trap runs.
      printf -v cleanup_command 'rm -rf -- %q' "$transition_directory"
      trap "$cleanup_command" EXIT
      guard="${transition_directory}/check"
      ln -s -- "${script_dir}/guard-linux-package-transition.sh" "$guard"
      printf 'Replacing the legacy git-khronos-desktop package. Review APT\047s transaction before confirming.\n'
      run_as_root apt-get install --reinstall \
        -o "DPkg::Pre-Install-Pkgs::=${guard}" \
        -o "DPkg::Tools::Options::${guard}::Version=2" \
        -o "DPkg::Tools::Options::${guard}::InfoFD=0" \
        -o "APT::Get::Assume-Yes=false" \
        "$package_file"
      trap - EXIT
      rm -rf -- "$transition_directory"
      ;;
    *) run_as_root apt-get install --reinstall --no-remove "$package_file" ;;
  esac
  printf '\nGit Khronos is installed. Launch it from the application menu or run git-khronos.\n'
}

uninstall_package() {
  require_apt
  local package_status
  package_status="$(dpkg-query --show --showformat='${db:Status-Status}' "$package_name" 2>/dev/null || true)"
  # Interrupted installation still owns package files. Let APT remove them
  # normally, without forcing removal or purging retained configuration.
  case "$package_status" in
    installed|unpacked|half-installed|half-configured|triggers-awaited|triggers-pending) ;;
    *)
      printf 'Git Khronos is not installed as a Debian package.\n'
      return
      ;;
  esac
  printf 'Removing the system-wide Git Khronos package. Repository data and user preferences are not removed.\n'
  run_as_root apt-get remove "$package_name"
}

require_package_tools
case "${1:-}" in
  name) name_package ;;
  verify) verify_package ;;
  install) install_package ;;
  uninstall) uninstall_package ;;
  print-package) print_package ;;
  *) fail "usage: $0 {name|verify|install|uninstall|print-package}" ;;
esac
