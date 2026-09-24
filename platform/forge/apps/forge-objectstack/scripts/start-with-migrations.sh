#!/bin/sh
set -eu

# Compose runs one application process. The previous process must be stopped
# before widening legacy lease columns and returning its claims to pending.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$SCRIPT_DIR/notification-lease-preflight.mjs"
exec "$@"
