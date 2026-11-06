import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(
  fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");
const core = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/LocalPublicServiceBackup.kt");
const saved = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/SavedPublicServices.kt");
const hidden = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/HiddenPublicServices.kt");
const ui = read("apps/android/app/src/main/java/com/rekixo/jodlo/LocalDataTransferDashboard.kt");
const file = read("apps/android/app/src/main/java/com/rekixo/jodlo/LocalPortableFileIO.kt");
const main = read("apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt");
const help = read("apps/android/app/src/main/java/com/rekixo/jodlo/HelpAndPrivacyDashboard.kt");
const en = read("apps/android/app/src/main/res/values/strings.xml");
const hi = read("apps/android/app/src/main/res/values-hi/strings.xml");

test("Portable file accepts only bounded, versioned, opaque public references", () => {
  assert.match(core, /MAX_BYTES = 32_768/);
  assert.match(core, /hasDuplicateJsonObjectKeys\(text, Json\)/);
  assert.match(read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloReplyDecoder.kt"),
    /internal fun hasDuplicateJsonObjectKeys/);
  const impact = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/LocalBackupMergeImpact.kt");
  assert.match(impact, /SAVED_CATEGORY_CONFLICT/);
  assert.match(impact, /SAVED_CAPACITY/);
  assert.match(impact, /HIDDEN_CAPACITY/);
  assert.doesNotMatch(impact, /RequestSender\s*\(|HttpMethod\.|http:\/\/|https:\/\//);
  assert.match(core, /root\.keys != setOf\("format", "version", "saved", "hidden"\)/);
  assert.match(core, /obj\.keys != setOf\("id", "categoryId"\)/);
  assert.match(core, /saved\.entries\.size != savedArray\.size/);
  assert.match(core, /hidden\.ids\.size != hiddenArray\.size/);
  assert.match(core, /SavedPublicServices\.decode/);
  assert.match(core, /HiddenPublicServices\.decode/);
  assert.doesNotMatch(core, /HttpMethod\.|Authorization|RequestSender\s*\(|GoogleSubject|workerId|locationLatitude|phoneNumber/);
});

test("Storage Access Framework is user-driven, strict UTF8 and bounded before parsing", () => {
  assert.match(ui, /CreateDocument\("application\/json"\)/);
  assert.match(ui, /OpenDocument\(\)/);
  assert.match(ui, /pendingExport = LocalPublicServiceBackup\(saved, hidden\)/);
  assert.match(ui, /snapshot\.saved != saved \|\| snapshot\.hidden != hidden/);
  assert.match(file, /openInputStream\(uri\)/);
  assert.match(file, /out\.size\(\) \+ count > LocalPublicServiceBackup\.MAX_BYTES/);
  assert.match(file, /CodingErrorAction\.REPORT/g);
  assert.match(file, /openOutputStream\(uri, "wt"\)/);
  // Comments may document forbidden APIs; check executable Kotlin only.
  const executableFile = file.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.doesNotMatch(executableFile, /readBytes\s*\(|takePersistableUriPermission\s*\(|SharedPreferences|HttpURLConnection|Log\.|println\(/);
  assert.doesNotMatch(ui, /startActivity|ACTION_SEND|Intent\.ACTION_SEND|ClipboardManager|WebView|Uri\.parse/);
});

test("Import requires independent explicit Saved and Hidden merge and durable commit", () => {
  assert.match(ui, /preview = result/);
  assert.match(ui, /LocalBackupMergeImpact\.inspect\(saved,hidden,result\)/);
  assert.match(ui, /impact\.hiddenSavedIfBothMerged/);
  assert.match(ui, /saved\.mergeFrom\(incoming\.saved\)/);
  assert.match(ui, /hidden\.mergeFrom\(incoming\.hidden\)/);
  assert.match(ui, /onClick = ::applySaved/);
  assert.match(ui, /onClick = ::applyHidden/);
  assert.match(main, /fun applyImportedSaved\(next: SavedPublicServices\): Boolean/);
  assert.match(main, /fun applyImportedHidden\(next: HiddenPublicServices\): Boolean/);
  assert.match(main, /if \(!savedStore\.write\(next\)\) return false/);
  assert.match(main, /if \(!hiddenStore\.write\(next\)\) return false/);
  assert.match(saved, /fun mergeFrom\(incoming: SavedPublicServices\): SavedPublicServices\?/);
  assert.match(saved, /it\.categoryId != row\.categoryId/);
  assert.match(hidden, /fun mergeFrom\(incoming: HiddenPublicServices\): HiddenPublicServices\?/);
  assert.match(main, /"local-data" -> LocalDataTransferDashboard\(/);
  assert.match(help, /JodloTextAction\(onClick = onLocalData\)/);
});

test("Both languages explain privacy, merge conflicts and no automatic syncing", () => {
  const keys = [
    "local_backup_saved_impact", "local_backup_hidden_impact",
    "local_backup_saved_conflict", "local_backup_saved_limit",
    "local_backup_hidden_limit", "local_backup_saved_still_hidden",
    "local_backup_tab", "local_backup_heading", "local_backup_privacy",
    "local_backup_current", "local_backup_export_heading",
    "local_backup_export_notice", "local_backup_export_action",
    "local_backup_import_heading", "local_backup_import_notice",
    "local_backup_import_action", "local_backup_preview_heading",
    "local_backup_preview_counts", "local_backup_merge_notice",
    "local_backup_merge_saved_action", "local_backup_merge_hidden_action",
    "local_backup_discard_preview", "local_backup_cancelled",
    "local_backup_changed", "local_backup_export_saved",
    "local_backup_export_failed", "local_backup_invalid",
    "local_backup_preview_ready", "local_backup_merge_blocked",
    "local_backup_no_new_entries", "local_backup_saved_merged",
    "local_backup_hidden_merged", "local_backup_merge_failed",
  ];
  for (const key of keys) {
    assert.ok(en.includes(`name="${key}"`), "English missing " + key);
    assert.ok(hi.includes(`name="${key}"`), "Hindi missing " + key);
  }
  assert.match(en, /does not sync it automatically/);
  assert.match(hi, /खुद सिंक नहीं करता/);
  assert.match(en, /Conflicting Saved Categories/);
  assert.match(hi, /पुरानी पहचानें बनी रहेंगी/);
});
