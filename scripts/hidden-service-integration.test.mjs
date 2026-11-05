import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) =>
  readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");
const core = source("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/HiddenPublicServices.kt");
const savedCore = source("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/SavedPublicServices.kt");
const main = source("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");
const feed = source("apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt");
const saved = source("apps/android/app/src/main/java/com/rekixo/jodlo/SavedServicesDashboard.kt");
const hidden = source("apps/android/app/src/main/java/com/rekixo/jodlo/HiddenServicesDashboard.kt");
const help = source("apps/android/app/src/main/java/com/rekixo/jodlo/HelpAndPrivacyDashboard.kt");
const device = source("apps/android/app/src/main/java/com/rekixo/jodlo/DeviceHiddenServices.kt");
const en = source("apps/android/app/src/main/res/values/strings.xml");
const hi = source("apps/android/app/src/main/res/values-hi/strings.xml");
const gradle = source("apps/android/core/build.gradle.kts");

test("A hide remains an opaque, bounded local-only ID with strict storage", () => {
  assert.match(core, /MAX_ENTRIES = 100/);
  assert.match(core, /JodloRoutes\.requireListingId\(id\)/);
  assert.match(core, /ids\.toSet\(\)\.size != ids\.size/);
  assert.match(core, /fun visible\(rows: List<PublicListing>\)/);
  assert.match(device, /getSharedPreferences\(/);
  assert.match(device, /Context\.MODE_PRIVATE/);
  assert.match(device, /prefs\.edit\(\)\.putString\(key, value\.encode\(\)\)\.commit\(\)/);
  assert.doesNotMatch(core + device, /RequestSender\s*\(|HttpMethod\.|OAuth|Bearer |fetch\(|retrofit|Room\.databaseBuilder|workerAccountId/);
});
test("Native Browse, Feed, Saved and Help all share explicit hide and restore", () => {
  assert.match(main, /val next = hiddenServices\.hide\(id\)/);
  assert.match(main, /if \(next == hiddenServices \|\| !hiddenStore\.write\(next\)\) return false/);
  assert.match(main, /items\(visibleListings, key = \{ "public-" \+ it\.id \}\)/);
  assert.match(main, /"hidden" -> HiddenServicesDashboard\(/);
  assert.match(main, /hidden = hiddenServices, onHide = ::hideService/);
  assert.match(feed, /val visibleListings = hidden\.visible\(listings\)/);
  assert.match(feed, /items\(visibleListings, key = \{ "all-public-" \+ it\.id \}\)/);
  assert.match(feed, /if \(onHide\(id\)\) leaveDetail\(\)/);
  assert.match(saved, /val saved = savedOriginal\.withoutHidden\(hidden\)/);
  assert.match(savedCore, /SavedPublicServices\(hidden\.visible\(entries\)\)/);
  assert.match(saved, /review\.nextBatch\(saved\)/);
  assert.match(saved, /client\.approvedServiceDetail\(row\.id,row\.categoryId,selectedLanguage\)/);
  assert.match(hidden, /onUnhide: \(String\) -> Boolean/);
  assert.match(hidden, /onClear: \(\) -> Boolean/);
  assert.match(help, /JodloTextAction\(onClick = onHidden\)/);
  assert.match(main, /onHidden = \{ section = "hidden" \}/);
  assert.doesNotMatch(core + device + hidden, /reportService\(|blockWorker\(|moderationApi|Agora|pushToken/);
});
test("Hindi and English describe exact no-server-action limits and failures", () => {
  const keys = [
    "hidden_tab", "hidden_heading", "hidden_privacy_note", "hidden_manage",
    "hidden_count", "hidden_empty", "hidden_hide_here", "hidden_unhide",
    "hidden_restored", "hidden_saved_locally", "hidden_storage_failed",
    "hidden_page_filtered", "hidden_saved_filtered",
    "hidden_clear_start", "hidden_clear_warning", "hidden_clear_confirm", "hidden_cleared",
  ];
  for (const key of keys) {
    assert.ok(en.includes(`name="${key}"`), "English missing " + key);
    assert.ok(hi.includes(`name="${key}"`), "Hindi missing " + key);
  }
  assert.match(en, /does NOT report or block a Worker/);
  assert.match(hi, /शिकायत या सर्वर पर Block नहीं होता/);
  assert.match(en, /An existing Saved bookmark is kept/);
  assert.match(gradle, /mainClass\.set\("com\.rekixo\.jodlo\.core\.network\.HiddenPublicServicesTestKt"\)/);
});
