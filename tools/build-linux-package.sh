#!/usr/bin/env bash
# Build one local or Jammy artifact without overlapping writes to workspace outputs.
set -euo pipefail

flavor="${1:-}"
checksum="${2:-}"
tauri_config="${3:-}"
case "$flavor" in
  local) extra_config=() ;;
  ubuntu-jammy) extra_config=(--config packaging/linux/ubuntu-jammy.conf.json) ;;
  *) printf 'Expected local or ubuntu-jammy package flavor.\n' >&2; exit 2 ;;
esac
[[ -n "$checksum" && -n "$tauri_config" ]] || { printf 'Missing package checksum or Tauri configuration.\n' >&2; exit 2; }
command -v flock >/dev/null || { printf 'Git Khronos: flock (util-linux) is required to build a Linux package.\n' >&2; exit 1; }

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$root"
mkdir -p -- target
# Renderer and package assets are shared even with different CARGO_TARGET_DIRs.
# Keep the lock file in place; closing this descriptor releases the lock.
exec 9>>target/.git-khronos-linux-package.lock
if ! flock --exclusive --nonblock 9; then
  printf 'Git Khronos: another Linux package build holds this workspace lock, or the filesystem cannot lock it.\n' >&2
  exit 1
fi

node tools/check-linux-package-watcher.mjs apps/desktop/src-tauri/Cargo.toml
node tools/package-build-receipt.mjs begin "$checksum"
export TMPDIR="${TMPDIR:-$PWD/target/package-tmp}"
mkdir -p -- "$TMPDIR"
pnpm exec tauri build --bundles deb --config "$tauri_config" "${extra_config[@]}"
tools/manage-linux-package.sh name
if [[ "$flavor" == ubuntu-jammy ]]; then
  package_file="$(tools/manage-linux-package.sh print-package)"
  node tools/check-linux-abi.mjs "$package_file"
fi
node tools/package-build-receipt.mjs complete "$checksum"
