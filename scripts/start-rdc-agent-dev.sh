#!/usr/bin/env sh
set -eu
exec "$(dirname -- "$0")/run-rdc-launcher.sh" --mode desktop-dev "$@"
