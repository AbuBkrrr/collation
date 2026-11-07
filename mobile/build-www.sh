#!/bin/sh
# Assembles mobile/www from the observer web app. The Android app bundles the UI and talks to the
# Command Center server (chosen on first launch) for API, WebSocket, LiveKit video and the Vosk model.
set -e
cd "$(dirname "$0")"
ROOT=..
rm -rf www && mkdir -p www/shared www/vendor www/vendor/fa/css www/vendor/fa/webfonts www/vendor/fonts/inter/files www/vendor/fonts/jetbrains-mono/files
cp "$ROOT/public/observer/index.html" www/app.html
python3 inject.py www/app.html                          # set MCC_BASE early + add change-server gear
cp www-src-index.html www/index.html                    # first-run launcher
cp "$ROOT/public/shared/ui.js" "$ROOT/public/shared/style.css" "$ROOT/public/shared/fonts.css" www/shared/
cp "$ROOT/node_modules/livekit-client/dist/livekit-client.umd.js" www/vendor/livekit-client.umd.js
cp "$ROOT/node_modules/vosk-browser/dist/vosk.js" www/vendor/vosk.js
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/css/all.min.css" www/vendor/fa/css/
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900."* www/vendor/fa/webfonts/
cp "$ROOT/node_modules/@fortawesome/fontawesome-free/webfonts/fa-brands-400."* www/vendor/fa/webfonts/ 2>/dev/null || true
cp "$ROOT/node_modules/@fontsource/inter/files/"inter-latin-*-normal.woff2 www/vendor/fonts/inter/files/
cp "$ROOT/node_modules/@fontsource/jetbrains-mono/files/"jetbrains-mono-latin-*-normal.woff2 www/vendor/fonts/jetbrains-mono/files/
for w in 300 400 500 600 700; do cp "$ROOT/node_modules/@fontsource/inter/$w.css" "www/vendor/fonts/inter/$w.css"; done
for w in 400 500; do cp "$ROOT/node_modules/@fontsource/jetbrains-mono/$w.css" "www/vendor/fonts/jetbrains-mono/$w.css"; done
echo "www assembled"
