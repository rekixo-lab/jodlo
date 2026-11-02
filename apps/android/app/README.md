# JODLO native Android app — Customer and Worker flows

> **Founder-approved UI theme (2026-11-02):** Every Android screen now shares the [black/teal flat outlined reference](../../../docs/UI_REFERENCE_2026-11-02.md) through `JodloTheme` and `JodloComponents`. No light-mode substitution, raised cards, glossy visuals or fake active calling/ads.

This module adds a real Android `:app` with a launcher Activity, Compose UI, Hindi and English resources, and **read-only guest** Category browse/search/public-listing screens. It reuses the existing compiled `:core` secure one-shot HTTPS transport, typed DTOs and repository validation; no duplicate HTTP stack.

## Build (Android SDK 35 required)

The existing headless CI remains SDK-free. Enable the Android app only on the native build command:

```bash
gradle -p apps/android -PincludeAndroidApp=true :app:assembleDebug --no-daemon
```

Optionally supply a separately reviewed, deployed **HTTPS origin without a path**:

```bash
gradle -p apps/android -PincludeAndroidApp=true -PjodloApiOrigin=https://YOUR_APPROVED_API_HOST :app:assembleDebug --no-daemon
```

Do not use a Cloudflare secret, account token, Google ID token or any personal URL as the origin. Default is empty: app shows that live catalog is not connected. No real backend has been deployed by this PR.

## What this does / does not prove

- Guest Browse sends up to one 20-item paged GET; Search explicitly checks 2–64 characters and presents only returned Category/choice names. A user must select a Category to issue a public Listings GET. Old responses are ignored after language change, navigation or a subsequent request.
- HTTPS reads are performed on `Dispatchers.IO`, never on the Android main thread. The existing core handles timeouts, redacted errors, no redirects and strict payload validation. No automatic write/retry, login, background tracking, fake worker profile, phone contact, calls, payments or collection of GPS/PII exists.
- Native CI must compile an actual `:app:assembleDebug` with Android SDK (in a separate workflow); existing JVM tests still run unchanged. A successful compile is **not** emulator/device acceptance, user research, approved final screen design or a release-ready APK.
- Palette is a **provisional engineering preview**, not a recorded founder choice among the three proposed visual themes. Screen flow, tokens, accessibility and selective motion still need real design/device review. Do not publish.

## 2026-11-02 — Optional real Google Credential Manager + Worker Dashboard source

The app now exposes a **separate Worker tab** which is fail-closed until BOTH an approved HTTPS backend and a public **Google WEB OAuth client ID** are configured. It uses Android Credential Manager's explicit Google sign-in button, hands the transient Google ID token to the existing `InMemorySessionCoordinator.signInWithGoogleIdToken`, and leaves token validation entirely to JODLO's backend. No client secret, OAuth password, account ID, GPS, phone number or durable device session is stored.

For a locally tested developer build **after proper OAuth console / signing SHA setup**:

```bash
gradle -p apps/android -PincludeAndroidApp=true \
  -PjodloApiOrigin=https://YOUR_APPROVED_API_HOST \
  -PjodloGoogleWebClientId=YOUR_PUBLIC_WEB_CLIENT_ID :app:assembleDebug --no-daemon
```

The worker screen checks a private worker draft, offers explicit opt-in, reads owner-only paged listings, and lets a signed-in worker explicitly select a currently approved Category to publish or select a private listing to unpublish. Every mutation is mediated by the existing headless `HeadlessWorkerWriteScope`: uncertain POST/DELETE acknowledgements are NEVER retried automatically. Rechecks are read-only and are not transaction proof; local sign-out is first and server revocation may be uncertain. Google OAuth real-device proof, actual domain deployment, device accessibility, persistent session UX and production authorization remain unverified.

This feature adds no server route or D1 table and does not enable Agora, payments, or live customer-worker messaging. The default build with empty OAuth client ID remains safe and the Worker tab explains that configuration is missing.

## Install the debug APK on an Android phone (developer-only test)

The [no-deploy Android CI workflow](../../../.github/workflows/android-native.yml) now uploads a **seven-day temporary APK artifact** for successful `main` builds. This contains only the generated debug build; there is no release keystore, production build signing, Play Store upload or remote backend deployment.

1. Open [GitHub Actions — JODLO native Android APK compile](https://github.com/rekixo-lab/jodlo/actions/workflows/android-native.yml).
2. Open the newest **successful main-branch** run (not an unmerged PR check). In its **Artifacts** section download `jodlo-debug-apk-<commit-sha>` (a ZIP). The artifacts section may require signing in to GitHub.
3. Extract the ZIP on your phone (or computer), find `app-debug.apk`, then open that APK on an Android device running **Android 8.0 or newer**. If Android asks, allow installation **only for the app/file manager you trust**; do not disable Google Play Protect.
4. Check the launcher, flat black/green/outlined Customer/Worker screens, Hindi/English text, scrolling, rotation and system-back behavior. Report screenshots/crashes, especially on small screens and large font sizes.
5. This **default APK has no configured HTTPS API origin or Google OAuth Web client ID**. Catalog fetch, worker login, publishing, Agora calls, messaging, payments and live provider discovery are not functional. This is an offline UI/build smoke test, **not** a usable live marketplace or production-ready release.

Use the workflow's **Run workflow** action (on the default branch) to regenerate an artifact after its seven-day expiration. Never treat this debug-signed APK as a store/release build.

## Local Ubuntu/Linux: one-command build and install on connected Android

For a **developer debug APK** (Android 8.0+), this repo now contains the
self-contained `scripts/android-device.sh`. It **never** deploys to Cloudflare,
uninstalls an app, uploads an APK, requests a password or changes release signing.

Requirements (install once): JDK 17, Gradle 8.10.2, Android SDK platform 35,
build-tools 35.0.0, Android platform-tools/ADB, and Node 22 for npm shortcuts.
On a phone: enable Developer Options → USB debugging, connect a data-capable
USB cable, unlock it and approve the RSA USB debugging authorization prompt.

```bash
cd ~/jodlo
git pull --ff-only origin main
npm run android:devices  # inspect "device" rather than "unauthorized"/"offline"
npm run android:run      # BUILD → adb install -r → launch app automatically
```

Choose a particular phone when two devices/emulators are attached:

```bash
npm run android:run -- --serial DEVICE_SERIAL
# or: ANDROID_SERIAL=DEVICE_SERIAL npm run android:run
```

Other shortcuts: `npm run android:build` builds without a phone;
`npm run android:install` builds and installs without opening it;
`npm run android:device-tests` exercises the guard with fake ADB and Gradle,
never touching a phone. APK stays at
`apps/android/app/build/outputs/apk/debug/app-debug.apk`.

The installer checks exactly one **authorized** connected device and a
nonempty APK, stops on any failed Gradle/ADB command and **never deletes
existing app data**. If `adb devices` is blank/unauthorized, fix USB
debugging/phone prompt/udev permission first. When an older app has a
different debug signature, `adb install -r` may reject the update; manual
uninstall **will erase that app's local data**, so do not do it casually.
If the device isn't reachable from Linux, no remote install is possible.

The default APK intentionally has no live HTTPS backend origin or Google OAuth
Web client ID; it is an **offline UI smoke-test build**, not a functional
Cloudflare/Agora/payment release. An automated command cannot prove that
the phone rendered every screen correctly—verify it on-device.

## 2026-11-02 — User-driven native Customer cursor pagination

The native Customer screen now explicitly supports:
- **Browse:** 20 active Categories per bounded GET, with a visible "Load more categories" control using the existing `nextCursor` from the HTTPS catalog API.
- **Search:** keep the existing first-page `includeChoices=1` ambiguity safety probe; when search actually spans beyond that first page, switch to the existing `cursor=1` exhaustive Search protocol **from page one** rather than mixing offset rows with cursor rows. Each later page requires another user tap. Short/unambiguous first-page Search stays one GET.
- **Public listings:** 20 public listing references per user-triggered GET via the existing `GET /api/v1/listings` keyset mode. No extra private fields, calling, ratings, contact details or publish actions are added.
- On language change, category selection/back, a new Search/Browse, or source replacement, old responses are discarded. Lost/stale/overlapping cursor pages cannot be added to a fresh list; unreadable next pages keep previous verified rows visible with a manual retry control. Invalidated public listing/category anchors clear the old rows rather than pretending they are still valid.
- All screen content scrolls in **one Compose LazyColumn**, including header, small-screen controls, item cards and pagination actions, using founder-approved flat dark outline tokens and English/Hindi strings.

This is a UI integration of **existing tested headless cursor APIs**, not a new backend route or approval/activation of historic Categories. The default debug APK still has no live HTTPS backend configured. Local compiled APK CI and future real-device UI tests must be distinguished.
