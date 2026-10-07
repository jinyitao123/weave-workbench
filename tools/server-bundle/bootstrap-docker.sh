#!/bin/sh
set -eu

# Invoked only by an explicit administrator install request with Docker absent.
if [ "$(uname -s)" != Linux ] || [ "$(id -u)" != 0 ]; then
  echo 'Docker installation requires root on a supported Ubuntu server.' >&2
  exit 2
fi
. /etc/os-release
if [ "${ID:-}" != ubuntu ]; then
  echo 'Automatic Docker prerequisites support Ubuntu 22.04, 24.04 and 26.04. Install Docker Engine and Compose using your distribution instructions for other systems.' >&2
  exit 2
fi
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ;;
  *) echo 'Unsupported Ubuntu version for automatic Docker installation.' >&2; exit 2 ;;
esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates docker.io docker-compose-v2
systemctl enable --now docker
docker compose version --short
