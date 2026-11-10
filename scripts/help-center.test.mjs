import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL("../" + relativePath, import.meta.url)), "utf8");

const html = read("apps/web/index.html");
const css = read("apps/web/styles.css");
const js = read("apps/web/app.js");
const screen = read(
  "apps/android/app/src/main/java/com/rekixo/jodlo/HelpAndPrivacyDashboard.kt",
);
const home = read(
  "apps/android/app/src/main/java/com/rekixo/jodlo/CustomerHome.kt",
);
const account = read(
  "apps/android/app/src/main/java/com/rekixo/jodlo/AccountDashboard.kt",
);
const main = read(
  "apps/android/app/src/main/java/com/rekixo/jodlo/MainActivity.kt",
);
const en = read("apps/android/app/src/main/res/values/strings.xml");
const hi = read("apps/android/app/src/main/res/values-hi/strings.xml");

const helpKeys = [
  "help_home_action", "help_account_action", "help_heading", "help_intro",
  "help_guest_heading", "help_guest_detail", "help_open_browse",
  "help_saved_heading", "help_saved_detail", "help_open_saved",
  "help_account_heading", "help_account_detail", "help_open_account",
  "help_worker_heading", "help_worker_detail", "help_open_worker",
  "help_rights_heading", "help_rights_detail", "help_policy_pending",
  "help_back_home",
];

test("Help website is bilingual, screen-reader reachable, and has no external assets", () => {
  assert.match(html, /<html lang="hi">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /data-language-panel="hi" lang="hi"/);
  assert.match(html, /data-language-panel="en" lang="en"/);
  assert.match(html, /data-language-button="hi" aria-pressed="true"/);
  assert.match(html, /data-language-button="en" aria-pressed="false"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<form\b|<iframe\b|<script[^>]+https?:\/\//i);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i);
  assert.doesNotMatch(css, /@import|url\s*\(\s*["']?https?:/i);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width: 720px/);
});

test("Language switch is display-only and does not store or transmit user data", () => {
  assert.match(js, /setAttribute\("aria-pressed"/);
  assert.match(js, /panel\.hidden\s*=/);
  assert.match(js, /document\.documentElement\.lang\s*=/);
  assert.doesNotMatch(js.replace(/^\s*\/\/.*$/gm, ""), /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|\bcookie\b\s*=|navigator\.geolocation|sendBeacon|new\s+WebSocket/i);
  assert.doesNotMatch(html, /name=["'](?:email|phone|address|accountId)["']/i);
});

test("Actual data controls are described without pretending legal approvals or deletion", () => {
  assert.match(html, /Export and sign-out do not erase account data/);
  assert.match(html, /साइन-आउट से डेटा नहीं मिटता/);
  assert.match(html, /not a final Privacy Policy/);
  assert.match(html, /staffed support contact are not yet implemented or approved/);
  assert.match(html, /no identity, location or support-submission form/);
  assert.match(html, /Bilaspur|nearby Worker matching/);
});

test("Native Help routes to existing controls and localizations are complete", () => {
  for (const key of helpKeys) {
    for (const [locale, xml] of [["en", en], ["hi", hi]]) {
      assert.ok(xml.includes(`name="${key}"`), `Missing ${locale}:${key}`);
    }
  }
  for (const action of ["onHome", "onBrowse", "onSaved", "onAccount", "onWorker"]) {
    assert.match(screen, new RegExp(`onClick = ${action}`));
  }
  assert.match(screen, /BackHandler\(onBack = onHome\)/);
  assert.match(main, /"help" -> HelpAndPrivacyDashboard\(/);
  assert.match(main, /"saved" -> SavedServicesDashboard\(/);
  assert.match(main, /else -> AccountDashboard\([\s\S]*?activity, session, openHelp/);
  assert.match(home, /JodloTextAction\(onClick = openHelp(?:,|\))/);
  assert.match(account, /JodloTextAction\(onClick = openHelp\)/);
  assert.doesNotMatch(screen, /Http|Repository|ContentResolver|SharedPreferences|ACTION_SEND|email|Uri\.|rememberSaveable/);
});


test("Account private summary and explicit file export use current owner/write epochs", () => {
  const session = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/InMemorySessionCoordinator.kt");
  const fence = read("apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/AccountPrivateSummaryFence.kt");
  assert.match(session, /fun accountPrivateReadMarker\(\): AccountPrivateReadMarker\?/);
  assert.match(session, /if \(owner\.mutationInFlight\) null/);
  assert.match(session, /AccountPrivateReadMarker\(generation, owner\.writeRevision\)/);
  assert.match(fence, /requestedAt != current/);
  assert.match(fence, /result !is SessionResult\.Success/);
  assert.match(fence, /if \(markerNow == marker\) overview else null/);
  assert.match(account, /AccountPrivateSummary\.confirmed\(requestedAt, current, result\)/);
  assert.match(account, /overview\?\.forCurrent\(currentMarker\)/);
  assert.match(account, /session\?\.accountPrivateReadMarker\(\) != marker/);
  assert.match(account, /current == captured/);
  assert.match(account, /Lifecycle\.Event\.ON_RESUME/);
  assert.match(account, /pendingExport = null/);
  assert.doesNotMatch(account, /rememberSaveable|Log\.|println\(|SharedPreferences|ACTION_SEND/);
  for (const xml of [en, hi]) assert.match(xml, /name="account_session_changed"/);
});
