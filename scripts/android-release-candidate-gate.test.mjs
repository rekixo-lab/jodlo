import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = path => readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");
const gradle = read("apps/android/app/build.gradle.kts");
const manifest = read("apps/android/app/src/main/AndroidManifest.xml");

test("release variant is opt-in and cannot silently appear in a debug-only build", () => {
  assert.match(gradle, /val releaseCandidateRequested = providers\.gradleProperty\("jodloReleaseCandidate"\)\.orNull == "true"/);
  assert.match(gradle, /androidComponents\s*\{[\s\S]*?beforeVariants\(selector\(\)\.withBuildType\("release"\)\)\s*\{\s*variant\s*->[\s\S]*?variant\.enable = releaseCandidateRequested/);
  assert.doesNotMatch(gradle, /variant\.enable\s*=\s*true/);
});

test("candidate requires dedicated HTTPS backend, nonempty Google OAuth, and explicit version bump", () => {
  assert.match(gradle, /if \(releaseCandidateRequested\) \{/);
  assert.match(gradle, /require\(apiOrigin == "https:\/\/api\.jodlo\.rekixo\.com"\)/);
  assert.match(gradle, /require\(googleWebClientId\.isNotBlank\(\)\)/);
  assert.match(gradle, /jodloReleaseVersionName/);
  assert.match(gradle, /jodloReleaseVersionCode/);
  assert.match(gradle, /candidateVersionCode != null && candidateVersionCode in 2\.\.2100000000/);
  assert.match(gradle, /versionCode = if \(releaseCandidateRequested\) requireNotNull\(candidateVersionCode\) else 1/);
  assert.match(gradle, /versionName = if \(releaseCandidateRequested\) candidateVersionName else "0\.1\.0-dev"/);
  // Kotlin raw patterns must use one backslash before each semantic-version dot.
  assert.ok(gradle.includes(String.raw`Regex("""^[1-9][0-9]{0,2}\.[0-9]{1,3}\.[0-9]{1,3}$""")`));
});

test("debug remains unconfigured and Android prevents cleartext and backups", () => {
  assert.match(gradle, /val apiOrigin = providers\.gradleProperty\("jodloApiOrigin"\)\.orNull\?\.trim\(\)\.orEmpty\(\)/);
  assert.match(gradle, /val googleWebClientId = providers\.gradleProperty\("jodloGoogleWebClientId"\)\.orNull\?\.trim\(\)\.orEmpty\(\)/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
});

test("CI enforces an unconfigured negative release build and candidate rejection", () => {
  const ci = read(".github/workflows/android-native.yml");
  assert.match(ci, /Ensure unconfigured release variants stay disabled/);
  assert.match(ci, /assembleRelease/);
  assert.match(ci, /bundleRelease/);
  assert.match(ci, /Reject release candidate without explicit operator settings/);
  assert.match(ci, /jodloReleaseCandidate=true/);
  assert.match(ci, /:app:help/);
});


test("CI proves an explicit, synthetic release candidate can be configured without building it", () => {
  const ci = read(".github/workflows/android-native.yml");
  const start = ci.indexOf("      - name: Verify configured release candidate tasks without building or signing");
  const end = ci.indexOf("      - name: Run Kotlin Core verification under JDK 21", start);
  assert.ok(start >= 0 && end > start, "A separate JDK21 positive/negative candidate preflight is required");
  const section = ci.slice(start, end);
  assert.match(section, /if: matrix\.java-version == '21'/);
  assert.match(section, /-PjodloReleaseCandidate=true/);
  assert.match(section, /-PjodloApiOrigin=https:\/\/api\.jodlo\.rekixo\.com/);
  assert.match(section, /-PjodloGoogleWebClientId=123456789012-jodlo-ci-only\.apps\.googleusercontent\.com/);
  assert.match(section, /-PjodloReleaseVersionName=1\.0\.0/);
  assert.match(section, /-PjodloReleaseVersionCode=2/);
  assert.match(section, /:app:tasks --all --no-daemon/);
  assert.match(section, /assembleRelease/);
  assert.match(section, /bundleRelease/);
  assert.match(section, /-PjodloReleaseVersionName=dev/);
  assert.match(section, /Release candidate needs explicit numeric major\.minor\.patch version name/);
  assert.doesNotMatch(section, /:app:(assembleRelease|bundleRelease|publish|sign)/);
  assert.doesNotMatch(section, /upload-artifact|wrangler deploy|google-play|fastlane|gh release/i);
});

test("Google Play 2026 Android 16 target is enforced in source, native CI and local QA", () => {
  const workflow = read(".github/workflows/android-native.yml");
  const foundation = read(".github/workflows/checks.yml");
  const localDevice = read("scripts/android-device.sh");
  const localMocks = read("scripts/android-device.test.sh");
  const mainActivity = read("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");

  assert.match(gradle, /id\("com\.android\.application"\) version "8\.10\.1"/);
  assert.match(gradle, /\bcompileSdk = 36\b/);
  assert.match(gradle, /\btargetSdk = 36\b/);
  assert.match(gradle, /\bminSdk = 26\b/);
  assert.doesNotMatch(gradle, /\b(?:compileSdk|targetSdk) = 35\b/);
  assert.match(workflow, /gradle-version: '8\.11\.1'/);
  assert.match(foundation, /gradle-version: '8\.11\.1'/);
  assert.match(workflow, /"platforms;android-36" "build-tools;36\.0\.0"/);
  // This must be tested from aapt's APK manifest, not assumed from build.gradle.
  assert.match(workflow, /aapt" dump badging apps\/android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.ok(workflow.includes("targetSdkVersion:'36'"));
  assert.ok(workflow.includes("sdkVersion:'26'"));
  assert.match(localDevice, /platforms\/android-36/);
  assert.match(localDevice, /build-tools\/36\.0\.0/);
  assert.match(localDevice, /gradle-8\.11\.1/);
  assert.match(localMocks, /missing Android 16 SDK\/build tools/);
  assert.match(mainActivity, /enableEdgeToEdge\(/);
  assert.match(mainActivity, /safeDrawingPadding\(\)/);
  assert.match(mainActivity, /BackHandler\(/);
});

test("CI compiles disposable unsigned API36 release AAB with no publication path", () => {
  const ci = read(".github/workflows/android-native.yml");
  const beginning = ci.indexOf("      - name: Compile disposable unsigned API 36 release AAB with synthetic config (never upload)");
  const ending = ci.indexOf("      - name: Compile FCM and Agora together using synthetic CI-only Firebase configuration", beginning);
  assert.ok(beginning > 0 && ending > beginning,
    "separate isolated release AAB compile check must be present");
  const section = ci.slice(beginning, ending);
  assert.match(section, /if: matrix\.java-version == '21'/);
  assert.match(section, /-PincludeAndroidApp=true/);
  assert.match(section, /-PjodloReleaseCandidate=true/);
  assert.match(section, /-PjodloApiOrigin=https:\/\/api\.jodlo\.rekixo\.com/);
  assert.match(section, /-PjodloGoogleWebClientId=123456789012-jodlo-ci-only\.apps\.googleusercontent\.com/);
  assert.match(section, /-PjodloReleaseVersionName=1\.0\.0/);
  assert.match(section, /-PjodloReleaseVersionCode=2/);
  assert.match(section, /:app:bundleRelease --no-daemon/);
  assert.match(section, /test -s "\$BUNDLE"/);
  assert.match(section, /unzip -Z -1 "\$BUNDLE"/);
  assert.match(section, /rm -f "\$BUNDLE"/);
  assert.match(section, /test ! -e "\$BUNDLE"/);
  assert.match(section, /-PjodloEnablePlayCheckout=true/);
  assert.match(section, /-PjodloPlayPolicyVersion=jodlo-play-minutes-v1/);
  assert.match(section, /--no-build-cache --rerun-tasks/);
  assert.match(section, /android-release-evidence\.py --compare "\$FIRST_BUNDLE" "\$BUNDLE"/);
  assert.match(section, /trap 'rm -f "\$BUNDLE" "\$FIRST_BUNDLE"' EXIT/);
  assert.doesNotMatch(section, /actions\/upload-artifact|fastlane|gradle.*:app:publish|wrangler deploy/);
});

test("CI compiles configured checkout/recovery and refuses missing policy without contacting providers",()=>{
  const ci=read(".github/workflows/android-native.yml");
  const start=ci.indexOf("      - name: Compile configured checkout and recovery UI with synthetic public settings");
  const end=ci.indexOf("      - name: Compile disposable unsigned API 36 release AAB",start);
  assert.ok(start>0&&end>start);
  const section=ci.slice(start,end);
  assert.match(section,/-PjodloEnablePlayBilling=true -PjodloEnablePlayCheckout=true/);
  assert.match(section,/-PjodloEnablePlayRestore=true -PjodloPlayPolicyVersion=jodlo-play-minutes-v1/);
  assert.match(section,/:app:compileDebugKotlin --no-daemon/);
  assert.match(section,/Reject checkout without explicit settlement policy/);
  assert.match(section,/Reject restored purchase UI in release candidates without the checkout policy/);
  assert.doesNotMatch(section,/\$\{\{\s*secrets\.|adb |:app:publish|wrangler deploy/);
});

test("CI continuously compiles the combined Agora, FCM and Play release without retaining a synthetic bundle",()=>{
  const ci=read(".github/workflows/android-native.yml");
  const start=ci.indexOf("      - name: Compile FCM and Agora together using synthetic CI-only Firebase configuration");
  const end=ci.indexOf("      - name: Save temporary debug APK",start);
  assert.ok(start>0&&end>start);
  const section=ci.slice(start,end);
  assert.match(section,/test ! -e "\$CONFIG"/);
  assert.match(section,/jodlo-ci-synthetic-not-real/);
  assert.match(section,/-PjodloEnableAgora=true -PjodloEnableFcm=true/);
  assert.match(section,/-PjodloEnablePlayBilling=true -PjodloEnablePlayCheckout=true/);
  assert.match(section,/-PjodloEnablePlayRestore=true -PjodloPlayPolicyVersion=jodlo-play-minutes-v1/);
  assert.match(section,/-PjodloReleaseCandidate=true/);
  assert.match(section,/:app:bundleRelease --no-daemon --no-build-cache/);
  assert.match(section,/android-release-evidence\.py --inspect "\$COMBINED_BUNDLE"/);
  assert.match(section,/trap 'rm -f "\$CONFIG" "\$COMBINED_BUNDLE"' EXIT/);
  assert.match(section,/test ! -e "\$COMBINED_BUNDLE"/);
  assert.doesNotMatch(section,/\$\{\{\s*secrets\.|upload-artifact|adb |:app:publish|wrangler deploy/);
});
