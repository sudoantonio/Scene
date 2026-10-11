#!/bin/bash
set -euo pipefail
scene_script_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
scene_source_dir=${1:-$scene_script_root}
scene_output_dir=${2:-$scene_script_root/release}
scene_evidence_dir=${3:-$scene_script_root/work-build/linux-evidence}
mkdir -p "$scene_output_dir" "$scene_evidence_dir"
scene_source_dir=$(CDPATH= cd -- "$scene_source_dir" && pwd)
scene_output_dir=$(CDPATH= cd -- "$scene_output_dir" && pwd)
scene_evidence_dir=$(CDPATH= cd -- "$scene_evidence_dir" && pwd)

docker run --rm --platform linux/amd64 --cpus=3 --memory=4g \
  --mount "type=bind,source=$scene_source_dir,target=/source,readonly" \
  --mount "type=bind,source=$scene_output_dir,target=/output" \
  --mount "type=bind,source=$scene_evidence_dir,target=/evidence" \
  node:22-bookworm-slim bash -c '
    set -euo pipefail
    apt-get update -qq
    apt-get install -y --no-install-recommends ca-certificates git xvfb xauth libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libdbus-1-3
    mkdir -p /tmp/scene
    tar -C /source --exclude=.git --exclude=node_modules --exclude=work-build --exclude=release --exclude="release-*" --exclude=dist --exclude=dist-electron --exclude=.vite-cache -cf - . | tar -C /tmp/scene -xf -
    cd /tmp/scene
    npm install -g pnpm@11.19.0
    pnpm install --frozen-lockfile
    pnpm test
    pnpm run build
    pnpm exec electron-builder --linux AppImage --x64 --publish never
    xvfb-run -a node scripts/verify-desktop-package.mjs release/linux-unpacked
    (cd release && sha256sum *.AppImage > SHA256SUMS-linux.txt)
    cp release/*.AppImage release/SHA256SUMS-linux.txt /output/
    cp work-build/packaged-qa/report-linux.json work-build/packaged-qa/camera-linux.jpg work-build/packaged-qa/native-linux.log /evidence/
  '
