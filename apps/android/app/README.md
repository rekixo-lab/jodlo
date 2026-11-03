# JODLO native Android app — Customer and Worker flows

## 2026-11-03 — Worker Category Search and explicit publication

The native **Worker Dashboard** now supports Hindi/English Category Search through the existing bounded `/api/v1/catalog/search?cursor=1` API and 20-item continuation, as well as the existing all-active-Category browse. This makes the full reviewed 889-Category direction navigable without pretending all 889 Categories are activated. Changing language or launching a new query clears old selection and cursor; typing after a submitted search does not change its continuation. Invalid queries, empty matches, failed pages and explicit retry have bilingual screen states.

Tap an approved Category to select it, then tap the **existing** authenticated Publish action to create/unhide your own Listing. Searching never publishes. Debug-only Customer sample data cannot authenticate a Worker or create real listings. This flow still requires an approved HTTPS backend, genuine OAuth and active reviewed Categories; no live credentials, real on-device worker acceptance or production release are claimed. [Detailed acceptance](../../../docs/WORKER_CATEGORY_SEARCH_PUBLISH_2026-11-03.md).

## 2026-11-03 — Customer published-service filter + fresh public Listing detail

Customer's **“Only categories with published services”** filter now uses the existing backend `availableOnly=1` for real Hindi/English Category browse and Search, including pagination. This is NOT Worker presence, availability for Agora calls or a verified badge. Selecting a Category still opens the existing paged public Listings; **tapping a Listing** now does one anonymous `GET /api/v1/listings/:id`, so the server rechecks publication, moderation, account and Category **at the moment of detail navigation**. If the old listing is no longer public, a 404 message is displayed and no private Worker fields are revealed. The only detail shown is the existing `id`/Category, pending approved public profile disclosure rules.

The clearly labeled **OFFLINE SAMPLE** in the debug APK supports this too: enable it explicitly, toggle published-only, observe six `demo_service_26…31` sample Categories disappear, open `demo_plumbing`, load the next page of 27 sample Listing IDs, tap one to view the currently synthetic public detail and use Back. With sample OFF, no live backend remains available by default. The Worker tab stays on real OAuth/backend only. [Feature acceptance](../../../docs/CUSTOMER_PUBLISHED_SERVICE_DISCOVERY_2026-11-03.md). Phone smoke-test still required; Android/Foundation CI passing is not on-device acceptance.

## 2026-11-03 — usable OFFLINE Customer discovery preview in debug APK

**This is executable app UI, not another backend test-only call experiment.** When the default debug APK has no configured HTTPS origin, Customer now offers **Explore offline sample services**. It is **off by default**, requires an explicit tap, and prominently says the data is synthetic—not real worker accounts or approved live Categories. The example adapter `DebugCustomerPreviewSender.kt` implements the existing **read-only** Kotlin `RequestSender`, feeding actual `RemoteCatalogRepository`, route validation, pagination validation and strict JSON DTO decoding. It never opens a socket and cannot be used to log in, post a listing, make a call or pay.

Try it on your phone after a successful **main** Android-native workflow artifact:

1. Launch the debug APK, open **Customer**, tap **Explore offline sample services**.
2. Browse sample Categories; switch Hindi/English. Search `service` in English or `सेवा` in Hindi, select a Category and use **Load more** for the 31-item sample. Try `Plumbing sample` for a synthetic 27-listing continuation.
3. Use Back, then **Close offline sample**; the screen clears sample results and returns to the unconfigured-API notice. Worker tab remains unable to authenticate against fake data.

The sample data uses only a `demo_` namespace, and it exists only in memory. The sample switch is gated by `BuildConfig.DEBUG` and is **hidden when a genuine build-time API origin is configured**. It does not claim active business listings, verification or a live service. Do not screenshot/market the sample as a real worker marketplace.

This is **milestone A** of the [product-first delivery plan](../../../docs/PRODUCT_DELIVERY_MILESTONES_2026-11-03.md). It does not replace actual on-device inspection, active Category review, Google OAuth setup, Agora tokens, backend deployment or founder privacy decisions. Android-native compile under JDK 17/21 and Foundation CI must both succeed on PR head and merged main.

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

Requirements (install once): **full JDK 17 or 21 (including javac)**, Gradle 8.10.2, Android SDK platform 35,
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

### Existing Java 21 works — no extra JDK download

The JODLO Kotlin Core and Android APK now support **building under a full
JDK 17 or JDK 21** while generating the original **Java 17-compatible
bytecode**. Kotlin and Java source targets are explicitly pinned to 17;
this differs from pinning the *installed build JDK* to 17. GitHub CI
compiles the actual Android APK with both installed JDKs and additionally
runs Core JVM verification on JDK 21.

On a Linux Mint or Ubuntu development computer that already has Java 21:

```bash
cd ~/jodlo
git pull --ff-only origin main
java -version     # Java 21 is fine
javac -version    # javac 21 is fine
npm run android:devices
npm run android:run
```

No apt install, Java downgrade or system alternatives change is needed.
If `JAVA_HOME` cannot be discovered, optionally use:
`JODLO_JDK_HOME=/usr/lib/jvm/java-21-openjdk-amd64 npm run android:run`.
The former `JODLO_JDK17_HOME` variable remains supported *only for JDK 17*;
do not point it to Java 21. Installer safety gates remain unchanged:
device authorization, exactly one selected device, build success and APK
existence before install, and no automatic uninstall or remote deployment.

Java 17 bytecode is necessary for compatibility but **does not substitute
for real-device Android API/behavior testing**.
