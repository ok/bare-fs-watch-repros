#!/bin/sh
# Linux, Docker, privileged: lower fs.inotify.max_user_watches to 40 (plus what the VM already
# holds) and arm 100 directory watches under Bare, then under Node as the control.
# The limit is kernel-global inside Docker Desktop's VM; it is restored at the end.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
docker run --rm --privileged --platform "${PLATFORM:-linux/arm64}" -v "$HERE:/src:ro" node:22-slim sh -c '
mkdir -p /w && cp /src/repro.js /src/package.json /w/ && cd /w
npm install --no-audit --no-fund --silent 2>&1 | tail -1
W=/proc/sys/fs/inotify/max_user_watches; ORIG=$(cat $W)
held=$(cat /proc/*/fdinfo/* 2>/dev/null | grep -c "^inotify" || true)
echo $((held + 40)) > $W
echo "max_user_watches: $ORIG -> $(cat $W) (VM already holds $held)"
node node_modules/bare-runtime/bin/bare repro.js limit 100
node repro.js limit 100
echo $ORIG > $W'
