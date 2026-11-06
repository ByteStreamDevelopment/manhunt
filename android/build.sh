#!/usr/bin/env bash
# Baut app-debug.apk (mit Debug-Schlüssel signiert, direkt installierbar).
set -euo pipefail
cd "$(dirname "$0")"
docker build -t manhunt-apk-builder .
docker run --rm \
  -v "$PWD":/project \
  -v manhunt-gradle-cache:/root/.gradle \
  manhunt-apk-builder gradle --no-daemon assembleDebug
mkdir -p out
cp app/build/outputs/apk/debug/app-debug.apk out/manhunt.apk
echo "Fertig: $PWD/out/manhunt.apk"
