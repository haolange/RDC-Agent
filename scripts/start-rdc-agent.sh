#!/usr/bin/env sh
set -eu
# Invoke via sh so the wrapper works even when git checkout does not preserve +x (100644).
exec sh "$(dirname -- "$0")/run-rdc-launcher.sh" --mode desktop "$@"
