#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(uname -s)" != Linux ]; then
  echo 'The server installer requires Linux. Use the desktop installer on employee computers.' >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.10 or newer is required. On Ubuntu: sudo apt-get update && sudo apt-get install python3' >&2
  exit 2
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo 'Python 3.10 or newer is required.' >&2
  exit 2
fi
exec python3 "$HERE/server_bundle.py" install "$@"
