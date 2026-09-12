#!/usr/bin/env bash
# Build a local preview against the same Linux baseline as GitHub releases.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cache="${XDG_CACHE_HOME:-$HOME/.cache}/stormdesk-appimage"
mkdir -p "$cache"
docker build --tag stormdesk-appimage-builder:22.04 \
  --file "$repo/scripts/AppImage.Dockerfile" "$repo/scripts"
docker run --rm --init --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$repo,dst=/work" \
  --mount "type=bind,src=$cache,dst=/cache" \
  --workdir /work \
  --env HOME=/cache --env CARGO_HOME=/cache/cargo \
  --env CARGO_TARGET_DIR=/work/src-tauri/target/appimage-ubuntu \
  --env CARGO_BUILD_JOBS=4 --env APPIMAGE_EXTRACT_AND_RUN=1 \
  stormdesk-appimage-builder:22.04 \
  tauri build --bundles appimage --config '{"bundle":{"createUpdaterArtifacts":false}}'
find "$repo/src-tauri/target/appimage-ubuntu/release/bundle/appimage" \
  -maxdepth 1 -name '*.AppImage' -type f -print
