# Android apps — Observer & Situation Room

Two Capacitor wrappers built from the same `mobile/` project: the **Observer** app (field agents) and the **Situation Room** app (LGA/area supervisors). Each bundles its web UI so it opens instantly, and talks to your Command Center server for login, GPS, live video, maps, voice tallies and uploads. They install side by side (distinct `applicationId`s) and both run in any browser too.

## Building the APKs (the easy way: CI)

The restricted dev container cannot compile an APK (Google's SDK/Maven hosts are blocked), so the APKs are built by **GitHub Actions** (`.github/workflows/android.yml`). It runs on a push that touches the apps (or on manual *Run workflow*), builds both APKs, uploads them as downloadable artifacts, and commits them to `apks/` in the repo. On your server, `git pull` then brings the APKs and they appear on the landing page (`/download/app` and `/download/room`) with QR codes. You can also drop a file at `DATA_DIR/observer.apk` or `DATA_DIR/room.apk` to override.

## What each app does

- **Observer** — first launch asks for the **Command Center web address**, then the normal observer screen: enter the code from the Situation Room and a PIN (the code locks to the phone). GPS keeps running with the screen off.
- **Situation Room** — enter the same address, then sign in with the room ID and passcode: the live map, collation and results in your hand.

The small gear at the bottom-left changes the saved address later.

## What the observer sees

1. First launch: the app asks for the **Command Center web address** (for example `https://collation.example.com`). It checks the address and remembers it. The small gear at the bottom-left changes it later.
2. Then the normal observer screen: enter the code from the Situation Room and a PIN. The code locks to this phone.

## Building locally (a PC with the Android SDK)

You need Node.js and the Android SDK (Android Studio, or the command-line tools). From the repo root run `npm ci`, then from this `mobile/` folder `npm ci`, then:

```bash
sh build-apk.sh observer   # → ../apks/observer.apk
sh build-apk.sh room       # → ../apks/room.apk
```

`build-apk.sh` assembles the chosen app's `www/`, brands the native project (`applicationId`, app label), runs `cap sync`, builds a debug APK and restores the native files. To work inside Android Studio instead: `npm run sync` then `npm run open`.

### A signed release APK (for the Play Store or direct install)

```bash
cd android
keytool -genkey -v -keystore collation.keystore -alias collation -keyalg RSA -keysize 2048 -validity 10000
./gradlew assembleRelease   # then sign app/build/outputs/apk/release/app-release-unsigned.apk with apksigner
```

Or use Android Studio: **Build → Generate Signed Bundle / APK**.

## Permissions

The app asks for camera, microphone, notifications and location. Location must be allowed **"all the time"** for GPS to keep updating while the app is in the background — Android shows this as a second prompt. The notification is the "Observer GPS active" status while location sharing runs.

## Notes

- The app requires an **HTTPS** Command Center address. A public domain with a real certificate works out of the box. A server on a local network with Caddy's own certificate needs that certificate installed on the phone first — prefer a public domain for the field.
- `appId` is `ng.com.mysituationroom.observer`; change it in `capacitor.config.json` and `android/app/build.gradle` before publishing under your own account.
- The web app and this app share one codebase. Observers who cannot install the app can still use `https://<domain>/observer/` in Chrome.
