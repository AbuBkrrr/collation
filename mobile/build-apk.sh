#!/bin/sh
# Builds a signed-debug Android APK for one of the apps and drops it in ../apks/<app>.apk.
# Needs the Android SDK (set ANDROID_SDK_ROOT) + JDK 17+. Run from CI or a machine with the SDK;
# it cannot run in the restricted build container (Google's Maven/SDK hosts are blocked there).
#
# Usage:  sh build-apk.sh [observer|room]      (default: observer)
set -e
cd "$(dirname "$0")"
APP="${1:-observer}"
case "$APP" in
  observer) APPID="ng.com.mysituationroom.observer"; LABEL="Collation Observer" ;;
  room)     APPID="ng.com.mysituationroom.room";     LABEL="Situation Room" ;;
  *) echo "unknown app '$APP' (use observer or room)"; exit 1 ;;
esac

sh build-www.sh "$APP"

AG=android/app/build.gradle
ST=android/app/src/main/res/values/strings.xml
CC=capacitor.config.json
# brand the native project for this app so both APKs install side by side (distinct applicationId)
sed -i.bak "s/applicationId \"[^\"]*\"/applicationId \"$APPID\"/" "$AG"
sed -i.bak "s|<string name=\"app_name\">[^<]*</string>|<string name=\"app_name\">$LABEL</string>|" "$ST"
sed -i.bak "s|<string name=\"title_activity_main\">[^<]*</string>|<string name=\"title_activity_main\">$LABEL</string>|" "$ST"
sed -i.bak "s|\"appId\": \"[^\"]*\"|\"appId\": \"$APPID\"|; s|\"appName\": \"[^\"]*\"|\"appName\": \"$LABEL\"|" "$CC"

npx cap sync android
( cd android && ./gradlew --no-daemon assembleDebug )

mkdir -p ../apks
cp android/app/build/outputs/apk/debug/app-debug.apk "../apks/$APP.apk"

# restore the branded native files so the next app build starts clean
for f in "$AG" "$ST" "$CC"; do [ -f "$f.bak" ] && mv "$f.bak" "$f"; done
echo "built ../apks/$APP.apk ($LABEL, $APPID)"
