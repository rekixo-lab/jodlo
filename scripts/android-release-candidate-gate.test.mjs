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
