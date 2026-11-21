#!/usr/bin/env bash
set -euo pipefail

. /etc/os-release
if [[ "${ID:-}:${VERSION_ID:-}:$(dpkg --print-architecture)" != 'ubuntu:22.04:amd64' ]]; then
  echo 'Ubuntu release packages must be built on Ubuntu 22.04 amd64.' >&2
  exit 1
fi
