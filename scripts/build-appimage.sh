#!/usr/bin/env bash
# Package the native Qt app, including its Qt/WebEngine dependencies.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
build=${1:-"$repo/build-appimage"}
output=${2:-"$repo/release-assets"}
cache="${XDG_CACHE_HOME:-$HOME/.cache}/stormdesk-native-packaging"
arch=$(uname -m)
case "$arch" in
  x86_64) deploy_sha=8aea8da0f7f7039d2a2cecb14657d752a222a5e1d3825caeef186c82f751cdd1
          qt_sha=cfc1055b2b9dbc08412b579f20990b7b41a17b61beaa5847dc9477c96c9e9617 ;;
  aarch64) deploy_sha=5c1fddf96066891e829831cac0d84424690f3b22846c7f8f1bb9990a5c6c73f4
           qt_sha=d5b5a9020065cefda8c7af7c9500f686b23640eac50c88201a81752c6ee2e49c ;;
  *) echo "Unsupported AppImage architecture: $arch" >&2; exit 1 ;;
esac
mkdir -p "$cache/$deploy_sha-$qt_sha" "$output"
tool_dir="$cache/$deploy_sha-$qt_sha"
for tool in linuxdeploy linuxdeploy-plugin-qt; do
  file="$tool_dir/$tool"
  if [ ! -f "$file" ]; then
    curl --fail --location --retry 3 "https://github.com/linuxdeploy/$tool/releases/download/continuous/$tool-$arch.AppImage" -o "$file"
  fi
  expected=$deploy_sha
  [ "$tool" = linuxdeploy-plugin-qt ] && expected=$qt_sha
  echo "$expected  $file" | sha256sum --check --status
  chmod +x "$file"
done
cmake -S "$repo" -B "$build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build" --parallel 2
appdir="$build/AppDir"
DESTDIR="$appdir" cmake --install "$build" --prefix /usr
export PATH="$tool_dir:$PATH"
export APPIMAGE_EXTRACT_AND_RUN=1
export QMAKE=${QMAKE:-$(command -v qmake6)}
platforms=$("$QMAKE" -query QT_INSTALL_PLUGINS)/platforms
export EXTRA_PLATFORM_PLUGINS=$(find "$platforms" -maxdepth 1 -name 'libqwayland*.so' -printf '%f\n' | sort | paste -sd ';')
export VERSION=${STORMDESK_PACKAGE_VERSION:-5.0.0-preview.1}
export OUTPUT="StormDesk_${VERSION}_${arch}.AppImage"
cd "$output"
linuxdeploy --appdir "$appdir" --plugin qt --output appimage
"./$OUTPUT" --appimage-extract-and-run --version
