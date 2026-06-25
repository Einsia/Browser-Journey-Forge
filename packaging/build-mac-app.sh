#!/usr/bin/env bash
# Assemble JourneyForgeLocal.app (unsigned wrapper) and zip it.
# Pure file ops — runs on any OS. The .app runs project code from the bundle
# and keeps venv/data/config in ~/Library/Application Support/JourneyForgeLocal.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-/tmp}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"            # absolute, so it's safe even if under REPO
ZIP="$OUT/JourneyForgeLocal-mac.zip"

# Assemble in a temp dir OUTSIDE the repo. Building inside the repo would make
# rsync copy the half-built bundle (and the CI out/ dir) into itself → nesting.
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
APP="$BUILD/JourneyForgeLocal.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/project"

cp "$REPO/packaging/mac-app/Info.plist" "$APP/Contents/Info.plist"
cp "$REPO/packaging/mac-app/launcher.sh" "$APP/Contents/MacOS/JourneyForgeLocal"
chmod +x "$APP/Contents/MacOS/JourneyForgeLocal"

# Copy the project into the bundle (prebuilt extension included; junk excluded).
rsync -a \
  --exclude='.git' --exclude='data' --exclude='.env.local' --exclude='.venv' \
  --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='out' --exclude='.pnpm-store' \
  --exclude='extension/.wxt' --exclude='extension/.output' \
  "$REPO"/ "$APP/Contents/Resources/project/"

# Zip with stored unix perms so the launcher stays executable on macOS.
rm -f "$ZIP"
( cd "$BUILD" && zip -q -9 -ry "$ZIP" "JourneyForgeLocal.app" )
echo "zip: $ZIP"
