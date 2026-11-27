#!/usr/bin/env bash
# Build one local or Jammy Linux artifact without overlapping writes to workspace outputs.
set -euo pipefail

flavor="${1:-}"
checksum="${2:-}"
tauri_config="${3:-}"
case "$flavor" in
  local) bundle=deb; extra_config=() ;;
  ubuntu-jammy) bundle=deb; extra_config=(--config packaging/linux/ubuntu-jammy.conf.json) ;;
  ubuntu-jammy-appimage)
    bundle=appimage
    extra_config=(--config packaging/linux/ubuntu-jammy.conf.json --config packaging/linux/appimage-notices.conf.json)
    ;;
  *) printf 'Expected local, ubuntu-jammy, or ubuntu-jammy-appimage package flavor.\n' >&2; exit 2 ;;
esac
[[ -n "$checksum" && -n "$tauri_config" ]] || { printf 'Missing package checksum or Tauri configuration.\n' >&2; exit 2; }
if [[ "$bundle" == appimage ]] && ! command -v file >/dev/null; then
  printf 'Git Khronos: the file command is required by the AppImage packager. Install the Ubuntu file package before rebuilding.\n' >&2
  exit 1
fi
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

node tools/finish-linux-package-cache.mjs --preflight

# Run under the same workspace lock, on both success and ordinary failure.
# Retain the package and its evidence, not the isolated job's Rust objects.
trap 'status=$?; trap - EXIT; NODE_DISABLE_COMPILE_CACHE=1 node tools/finish-linux-package-cache.mjs || { ((status != 0)) || status=1; }; exit "$status"' EXIT

node tools/check-linux-package-watcher.mjs apps/desktop/src-tauri/Cargo.toml
if [[ "$bundle" == deb ]]; then
  node tools/package-build-receipt.mjs begin "$checksum"
fi
# Task saw changed inputs (or requested a rebuild). Cargo's timestamp check
# can still accept an older workspace executable after a checkout or archive
# restore. Invalidate just workspace release artifacts, not dependency caches.
cargo clean --release --workspace --locked
export TMPDIR="${TMPDIR:-$PWD/target/package-tmp}"
mkdir -p -- "$TMPDIR"
pnpm exec tauri build --bundles "$bundle" --config "$tauri_config" "${extra_config[@]}"
if [[ "$bundle" == deb ]]; then
  tools/manage-linux-package.sh name
  if [[ "$flavor" == ubuntu-jammy ]]; then
    package_file="$(tools/manage-linux-package.sh print-package)"
    node tools/check-linux-abi.mjs "$package_file"
  fi
  node tools/package-build-receipt.mjs complete "$checksum"
else
  node tools/check-linux-appimage.mjs "${CARGO_TARGET_DIR:-target}/release/bundle/appimage"
fi
