#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/app/data}"

# Docker and hosting-platform mounts replace the ownership set in the image.
# Repair the mounted directory before returning to the unprivileged runtime user.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_dir"
  chown -R bun:bun "$data_dir"
  exec setpriv --reuid=bun --regid=bun --init-groups "$@"
fi

mkdir -p "$data_dir"
exec "$@"
