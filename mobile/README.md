# Collation Observer — Android app

A Capacitor wrapper around the observer web app. It bundles the UI, so it opens instantly and works offline, and it talks to your Command Center server for login, GPS, live video, voice tallies and the EC8A upload. GPS keeps running with the screen off (a foreground service), and the screen stays awake while streaming.

## What the observer sees

1. First launch: the app asks for the **Command Center web address** (for example `https://collation.example.com`). It checks the address and remembers it. The small gear at the bottom-left changes it later.
2. Then the normal observer screen: enter the code from the Situation Room and a PIN. The code locks to this phone.

## Build it (on a PC with Android Studio)

You need Node.js and Android Studio (with an Android SDK). From this `mobile/` folder:

```bash
npm install          # Capacitor and the plugins
npm run sync         # builds www/ from the observer app and copies it into android/
npm run open         # opens the project in Android Studio
```

In Android Studio, press **Run** to install on a connected phone (enable USB debugging first), or **Build → Build Bundle(s) / APK(s) → Build APK(s)** to produce an installable `app-debug.apk`.

`npm run sync` reruns the web build and `cap sync`. Run it again whenever the observer app changes.

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
