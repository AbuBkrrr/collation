#!/bin/sh
# Assembles mobile/www from one of the web apps so Capacitor can bundle it. The Android app ships the
# UI and talks to the Command Center server (chosen on first launch) for API, WebSocket, LiveKit video,
# maps and the Vosk model.
#
# Usage:  sh build-www.sh [observer|room]      (default: observer)
set -e
cd "$(dirname "$0")"
APP="${1:-observer}"
case "$APP" in
  observer) LABEL="Collation Observer" ;;
  room)     LABEL="Situation Room" ;;
  *) echo "unknown app '$APP' (use observer or room)"; exit 1 ;;
esac
ROOT=..
rm -rf www && mkdir -p www/shared www/vendor www/vendor/fa/css www/vendor/fa/webfonts www/vendor/leaflet www/vendor/fonts/inter/files www/vendor/fonts/jetbrains-mono/files
cp "$ROOT/public/$APP/index.html" www/app.html
python3 inject.py www/app.html                          # set MCC_BASE early + add change-server gear
cp www-src-index.html www/index.html                    # first-run launcher
python3 - "$LABEL" <<'PY'                                # brand the launcher for this app
import sys
lbl = sys.argv[1]; p = "www/index.html"
s = open(p).read().replace("Collation Observer", lbl)   # read first, then truncate+write
open(p, "w").write(s)
PY
cp "$ROOT/public/shared/ui.js" "$ROOT/public/shared/style.css" "$ROOT/public/shared/fonts.css" www/shared/
cp "$ROOT/node_modules/livekit-client/dist/livekit-client.umd.js" www/vendor/livekit-client.umd.js
cp "$ROOT/node_modules/vosk-browser/dist/vosk.js" www/vendor/vosk.js
cp "$ROOT/node_modules/read-excel-file/bundle/read-excel-file.min.js" www/vendor/read-excel-file.min.js
cp "$ROOT/node_modules/qrcode-generator/qrcode.js" www/vendor/qrcode.js 2>/dev/null || true
cp -r "$ROOT/node_modules/leaflet/dist/." www/vendor/leaflet/     # leaflet.js + leaflet.css + marker images
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/css/all.min.css" www/vendor/fa/css/
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900."* www/vendor/fa/webfonts/
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/webfonts/fa-brands-400."* www/vendor/fa/webfonts/ 2>/dev/null || true
cp "$ROOT/node_modules/@fontsource/inter/files/"inter-latin-*-normal.woff2 www/vendor/fonts/inter/files/
cp "$ROOT/node_modules/@fontsource/jetbrains-mono/files/"jetbrains-mono-latin-*-normal.woff2 www/vendor/fonts/jetbrains-mono/files/
for w in 300 400 500 600 700; do cp "$ROOT/node_modules/@fontsource/inter/$w.css" "www/vendor/fonts/inter/$w.css"; done
for w in 400 500; do cp "$ROOT/node_modules/@fontsource/jetbrains-mono/$w.css" "www/vendor/fonts/jetbrains-mono/$w.css"; done
echo "www assembled for $APP ($LABEL)"
