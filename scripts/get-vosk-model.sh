#!/bin/sh
# Downloads the small English Vosk model and packs it as tar.gz for on-device (WASM) offline speech recognition.
set -e
cd "$(dirname "$0")/.."; mkdir -p public/models /tmp/vm; cd /tmp/vm
curl -fsSL -o m.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip -q -o m.zip && tar -czf "$OLDPWD/public/models/vosk-model-small-en-us-0.15.tar.gz" vosk-model-small-en-us-0.15
cd /; rm -rf /tmp/vm; echo "Vosk model ready"
