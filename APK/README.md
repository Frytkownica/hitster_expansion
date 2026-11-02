# Hitster Ultimate APK

This is a small Kotlin Android wrapper around the existing web game. Its bundled
assets are served as a secure local origin so camera access and JSON `fetch()`
work in Android WebView.

## Build

1. Install Android Studio with Android SDK Platform 35 and JDK 17.
2. Open this `APK` folder in Android Studio and allow Gradle Sync to finish.
3. Choose **Build > Build APK(s)**. The debug APK is created at
   `app/build/outputs/apk/debug/app-debug.apk`.

## GitHub updates

The Options screen checks the latest public release at
`Frytkownica/hitster_expansion`. Each release needs a numeric version tag such
as `v1.2.0` and an `.apk` asset. Keep `versionName` in `app/build.gradle.kts`
in step with the tag and increase `versionCode` for every release. Sign every
release with the same private key; Android will verify it before updating.
The first sideloaded install may ask the user to allow APK installs from this
app and to confirm the update.

### Create a signed release APK

Create a release key once from this folder using JDK 17's `keytool`:

```bat
"%ProgramFiles%\Java\jdk-17\bin\keytool.exe" -genkeypair -v -keystore hitster-release.jks -alias hitster -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore and its passwords backed up securely. Android updates must be
signed with this same key. Create `keystore.properties` in this folder with:

```properties
storeFile=hitster-release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=hitster
keyPassword=YOUR_KEY_PASSWORD
```

The keystore and properties file are ignored by Git. Then run
`.\gradlew.bat assembleRelease`; the signed APK will be at
`app/build/outputs/apk/release/app-release.apk`.

The camera permission is requested only when the user opens the scanner. Spotify
previews and web fonts require an internet connection; the card database is
bundled in the app.
