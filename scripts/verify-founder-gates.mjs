/** Safety checks on CI/npm scripts and unapproved API/data changes.
 * ADR-0015 authorizes operator-controlled Cloudflare/Google onboarding and
 * production deployment, but NEVER auto-deploy on GitHub PR/push workflows.
 * This guard intentionally does not ban protected manual CLI releases.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Private controlled-verification routes are allowed in source. Their
// presence does not authorize setting any of the release flags in production.
const controlledCallRoutes = new Map([
  ["/api/v1/me/call-device", "CALL_DEVICES_ENABLED"],
  ["/api/v1/me/call", "CALL_SIGNALING_ENABLED"],
  ["/api/v1/me/call-invitation", "CALL_SIGNALING_ENABLED"],
  ["/api/v1/me/call-availability", "CALL_SIGNALING_ENABLED"],
  ["/api/v1/me/call-media", "CALL_MEDIA_VERIFICATION_ENABLED"],
]);
const CALL_DEVICE_MIGRATION = "0021_private_call_devices.sql";
const CREDIT_LEDGER_MIGRATION = "0024_private_call_credit_ledger.sql";
const PLAY_CONSUME_MIGRATION = "0025_play_consumable_outbox.sql";
const PLAY_REVOCATION_MIGRATION = "0026_play_revocation_fences.sql";
const allowedRoutes = new Set([
  "/api/v1/health", "/api/v1/catalog", "/api/v1/catalog/search",
  // Only signed Google Pub/Sub RTDN with approved OAuth and rate-limit bindings.
  // Default OFF, cannot credit minutes or process a purchase notification.
  "/api/v1/play/rtdn",
  // Only approved, default-OFF taxonomy hierarchy; no public Worker or GPS.
  "/api/v1/catalog/hierarchy",
  "/api/v1/auth/google", "/api/v1/auth/logout", "/api/v1/auth/logout-all",
  "/api/v1/me/worker-profile", "/api/v1/me/listings", "/api/v1/listings",
  // 2026-11-04: owner-only READs over already-approved JODLO D1 tables.
  // They create no new personal-data fields or external provider side effect.
  // Actual auth/SQL isolation and field redaction are tested separately.
  // This is NOT permission for public profile, account deletion, block or contact APIs.
  "/api/v1/me/overview", "/api/v1/me/data-export",
  // The authorized erasure route stays disabled without its release secret.
  "/api/v1/me/account-erasure", "/api/v1/me/contact-block", "/api/v1/me/contact-blocks",
  "/api/v1/me/call-preference",
  "/api/v1/me/call-history",
  "/api/v1/me/service-area", "/api/v1/me/service-details", "/api/v1/moderation/service-details",
  "/api/v1/me/service-photo", "/api/v1/moderation/service-photo", "/api/v1/listings/photo",
  "/api/v1/me/service-report", "/api/v1/me/service-appeal", "/api/v1/moderation/service-cases",
]);
const allowedTables = new Set([
  "call_history",
  // Local-only private entitlement accounting; no purchase, wallet or payment route.
  "call_credit_balances", "call_credit_events",
  "play_consume_outbox", "play_revocation_fences",
  "call_attempt_windows",
  "private_call_invitations",
  "private_call_dispatch_slots",
  "private_call_devices",
  "categories",
  // No auto-seed, no public data until human-reviewed Group/Family/mapping approval.
  "catalog_groups", "catalog_families", "catalog_family_categories",
  "accounts", "worker_profiles", "google_identities", "auth_sessions", "worker_listings", "worker_service_details", "worker_service_photos", "service_report_cases",
  // Exactly one newly engineered, non-recipient delivery receipt; never a
  // blanket permission for contact, notification preference or token storage.
  "notification_delivery_receipts",
  // This is a second *machine-only* notification table, not a recipient/token store.
  "notification_delivery_dead_letters",
  // Founder ADR-0014 explicitly approved this ONE private worker call switch.
  "worker_agora_call_preferences",
  // Founder 2026-11-03 approved offline implementation and schema preparation,
  // NOT actual call admission, data retention, live thresholds or provider use.
  "worker_agora_availability_preferences",
  "agora_account_blocks",
  "agora_abuse_window_counters",
]);
const RECEIPT_MIGRATION = "0005_notification_delivery_receipts.sql";
const DEAD_LETTER_MIGRATION = "0006_notification_dead_letters.sql";
const DEAD_LETTER_FIELDS = ["event_id", "reason", "recorded_at_ms"];
const AGORA_PREFERENCE_MIGRATION = "0007_worker_agora_call_preferences.sql";
const AGORA_PREFERENCE_FIELDS = ["account_id", "calls_enabled", "revision"];
const AGORA_SAFETY_MIGRATION = "0008_agora_private_safety_state.sql";
const AGORA_SAFETY_SCHEMA = Object.freeze({
  worker_agora_availability_preferences:
    ["account_id", "accepting_calls", "revision"],
  agora_account_blocks:
    ["blocker_account_id", "blocked_account_id"],
  agora_abuse_window_counters:
    ["actor_account_id", "scope", "window_start_ms", "expires_at_ms",
      "attempt_count", "revision"],
});
const RECEIPT_FIELDS = [
  "event_id", "state", "claim_token", "lease_until_ms", "completed_at_ms",
];
async function required(root, path, errors) {
  try { return await readFile(join(root, path), "utf8"); }
  catch { errors.push("Missing required source: " + path); return null; }
}
function localOnlyCommands(text, label, errors) {
  for (const line of text.split("\n")) {
    // A dry-run in one command cannot authorize another deploy on the same line.
    for (const command of line.split(/&&|\|\||[;|]/)) {
      if (/\bwrangler\s+(?:deploy|publish)\b/i.test(command) && !/--dry-run\b/.test(command))
        errors.push(label + ": remote Wrangler deployment forbidden from CI/npm automation; use approved operator release runbook (ADR-0015)");
      if (/\bwrangler\s+(?:d1\s+[^\n]*--remote|pages\s+deploy|secret\s+put)\b/i.test(command) ||
          /\bfirebase\s+deploy\b/i.test(command) ||
          /cloudflare\/(?:wrangler|pages)-action/i.test(command))
        errors.push(label + ": remote infrastructure forbidden from CI/npm automation; use approved operator release runbook (ADR-0015)");
    }
  }
}
export async function auditFounderGates(root = rootDefault) {
  const errors = [];
  const router = await required(root,"apps/api/src/http/router.ts",errors);
  const catalog = await required(root,"apps/api/src/modules/catalog/catalog.ts",errors);
  const phrases = await required(root,"apps/api/src/modules/catalog/search-phrases.ts",errors);
  const workerSql = await required(root,"infra/migrations/0002_shared_accounts_worker_drafts.sql",errors);
  const adr = await required(root,"docs/decisions/0008-hindi-english-only.md",errors);
  const workflow = await required(root,".github/workflows/checks.yml",errors);
  const pkg = await required(root,"package.json",errors);
  // Literal router paths (not a complete parser for dynamically built routes).
  const routes = router === null ? [] :
    [...router.matchAll(/([\x22\x27\x60])(\/api\/v1\/[a-z0-9/_-]+)\1/g)].map(m=>m[2]);
  for(const route of new Set(routes))
    if(!allowedRoutes.has(route) && !controlledCallRoutes.has(route)) errors.push("Unapproved API route: " + route + " (M-005/M-003)");
  for (const [route, flag] of controlledCallRoutes) {
    if (routes.includes(route) && !router.includes(`env.${flag} === "1"`))
      errors.push("Private call route requires a default-OFF release gate: " + route);
  }
  for(const route of allowedRoutes)
    if(route!=="/api/v1/catalog/hierarchy" && route!=="/api/v1/me/account-erasure" &&
       route!=="/api/v1/me/contact-block" && route!=="/api/v1/me/contact-blocks" &&
       route!=="/api/v1/me/call-preference" && route!=="/api/v1/me/call-history" &&
       route!=="/api/v1/me/service-area" && route!=="/api/v1/me/service-details" &&
       route!=="/api/v1/moderation/service-details" && route!=="/api/v1/me/service-photo" &&
       route!=="/api/v1/moderation/service-photo" && route!=="/api/v1/listings/photo" &&
       route!=="/api/v1/me/service-report" && route!=="/api/v1/me/service-appeal" &&
       route!=="/api/v1/moderation/service-cases" && !routes.includes(route))
      errors.push("Previously approved API route missing: " + route);
  if(catalog !== null &&
     !/export\s+type\s+CatalogLanguage\s*=\s*["']en["']\s*\|\s*["']hi["']\s*;/.test(catalog))
    errors.push("Catalog locales must be exactly en|hi (ADR-0008)");
  if(phrases !== null) {
    if(!phrases.includes("HINDI_GRAMMAR") || !phrases.includes("ENGLISH_GRAMMAR") ||
       !/if\s*\(\s*hasHindi\s*&&\s*hasEnglish\s*\)\s*return\s*\[\s*\]\s*;/.test(phrases))
      errors.push("Separate Hindi/English grammar and mixed-script denial required");
    if(/["'](?:mujhe|chahiye|kaam|karta|karti|mere|meri)["']/.test(phrases))
      errors.push("Unsupported Romanized Hindi grammar reintroduced");
  }
  if(adr !== null && !/Hinglish is NOT a supported language/i.test(adr.replace(/\*\*/g,"")))
    errors.push("ADR-0008 Hindi/English-only rule missing");
  if(workerSql !== null) {
    const block=workerSql.replace(/--[^\n]*/g,"")
      .match(/CREATE\s+TABLE\s+worker_profiles\s*\(([\s\S]*?)\)\s*;/i);
    if(!block || !/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'draft'\s+CHECK\s*\(\s*status\s*=\s*'draft'\s*\)/i.test(block[1]))
      errors.push("Draft-only worker profile SQL CHECK must remain (M-005)");
  }
  let migrations=[];
  try { migrations=(await readdir(join(root,"infra/migrations"))).filter(n=>n.endsWith(".sql")).sort(); }
  catch { errors.push("D1 migrations directory missing"); }
  const tables=[];
  for(const name of migrations) {
    const sql=await required(root,"infra/migrations/"+name,errors);
    if(sql===null) continue;
    const content=sql.replace(/--[^\n]*/g,"");
    for(const match of content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z][a-z0-9_]*)/gi)) {
      const table=match[1].toLowerCase();
      tables.push(table);
      if(!allowedTables.has(table)) errors.push("Unapproved D1 table: "+table+" ("+name+")");
      if((table==="call_credit_balances" || table==="call_credit_events") &&
          name!==CREDIT_LEDGER_MIGRATION)
        errors.push("Private call credit tables require the scoped migration");
      if(table==="play_revocation_fences" && name!==PLAY_REVOCATION_MIGRATION)
        errors.push("Play revocation fences must use only scoped migration");
      if(table==="play_consume_outbox" && name!==PLAY_CONSUME_MIGRATION)
        errors.push("Play consume outbox must use only its scoped migration");
      if(table==="call_history" && name!=="0017_private_call_history.sql")
        errors.push("Private call history table is only allowed in its reviewed migration");
      if(table==="call_attempt_windows" && name!=="0018_call_attempt_windows.sql")
        errors.push("Private call attempt windows are only allowed in their reviewed migration");
      if(table==="private_call_invitations" && name!=="0019_private_call_invitations.sql")
        errors.push("Private call invitations are only allowed in their reviewed migration");
      if(table==="private_call_dispatch_slots" && name!=="0020_private_call_dispatch_slots.sql")
        errors.push("Private call dispatch slots are only allowed in their reviewed migration");
      if(table==="private_call_devices" &&
        (name!==CALL_DEVICE_MIGRATION ||
         !/session_hash TEXT PRIMARY KEY NOT NULL REFERENCES auth_sessions\(token_hash\) ON DELETE CASCADE/i.test(content)))
        errors.push("Private call devices must use the reviewed session-cascading migration");
      if(table==="notification_delivery_receipts" && name!==RECEIPT_MIGRATION)
        errors.push("Notification receipt table must use its reviewed migration: "+name);
      if(table==="notification_delivery_dead_letters" && name!==DEAD_LETTER_MIGRATION)
        errors.push("Notification dead-letter table must use its reviewed migration: "+name);
      if(table==="worker_agora_call_preferences" && name!==AGORA_PREFERENCE_MIGRATION)
        errors.push("Agora preference table must use its founder-approved migration: "+name);
      if(Object.hasOwn(AGORA_SAFETY_SCHEMA,table) &&
         name!==AGORA_SAFETY_MIGRATION)
        errors.push("Agora private safety table must use reviewed local migration: "+name);
    }
    if(name===CREDIT_LEDGER_MIGRATION) {
      // Local-only schema, strictly private ownership, hashed receipt keys,
      // bounded seconds, atomic event/balance update and no public checkout.
      if(!/CREATE TABLE call_credit_balances\s*\(/i.test(content) ||
         !/CREATE TABLE call_credit_events\s*\(/i.test(content) ||
         !/REFERENCES accounts\(id\) ON DELETE CASCADE/i.test(content) ||
         !/source_key_hash TEXT NOT NULL UNIQUE/i.test(content) ||
         !/CHECK\(seconds BETWEEN 1 AND 30000\)/i.test(content) ||
         !/CHECK\(available_seconds BETWEEN 0 AND 2147483647\)/i.test(content) ||
         !/CREATE TRIGGER apply_call_credit_event AFTER INSERT ON call_credit_events/i.test(content) ||
         !/UPDATE call_credit_balances/i.test(content))
        errors.push("Private credit ledger must be hashed, account-cascading, bounded and atomic");
      if(/\b(?:purchase_token|payment_receipt|raw_token|card_number|bank_account|email|phone|address)\b/i.test(content))
        errors.push("Private credit ledger must not store raw provider credentials or identity");
    }
    if(name===PLAY_REVOCATION_MIGRATION) {
      // Only globally unique opaque SHA256 tombstones. Out-of-order revocation
      // must abort future grants and freeze previously issued consume claims.
      if(!/CREATE TABLE play_revocation_fences\s*\(/i.test(content) ||
         !/source_key_hash TEXT PRIMARY KEY NOT NULL/i.test(content) ||
         !/CHECK\(reason IN \('one_time_canceled','voided_purchase'\)\)/i.test(content) ||
         !/CREATE TRIGGER reject_revoked_play_outbox/i.test(content) ||
         !/BEFORE INSERT ON play_consume_outbox/i.test(content) ||
         !/CREATE TRIGGER freeze_outbox_after_play_revocation/i.test(content) ||
         !/AFTER INSERT ON play_revocation_fences/i.test(content) ||
         !/UPDATE play_consume_outbox/i.test(content) ||
         !/CREATE TRIGGER deny_void_hold_resurrection/i.test(content))
        errors.push("Play revocation fence must be hashed, irreversible and enforce out-of-order denial");
      if(/\b(?:account_id|purchase_token|raw_token|order_id|product_id|email|phone|address|price|oauth_token|service_account|card_number)\b/i.test(content))
        errors.push("Play revocation fence must not persist raw token, SKU, account or finance/PII");
    }
    if(name===PLAY_CONSUME_MIGRATION) {
      // Outbox must not store raw Play tokens, OAuth credentials, order IDs or prices;
      // its sole grant path is an atomic D1 trigger into the existing credit journal.
      if(!/CREATE TABLE play_consume_outbox\s*\(/i.test(content) ||
         !/source_key_hash TEXT PRIMARY KEY NOT NULL/i.test(content) ||
         !/REFERENCES accounts\(id\) ON DELETE CASCADE/i.test(content) ||
         !/CHECK\(status IN \('ready','sending','unknown','consumed','void_hold'\)\)/i.test(content) ||
         !/CREATE\s+TRIGGER\s+grant_play_outbox_credit\s+AFTER\s+INSERT\s+ON\s+play_consume_outbox/i.test(content) ||
         !/INSERT INTO call_credit_events\(/i.test(content) ||
         !/NEW.source_key_hash/i.test(content))
        errors.push("Play outbox must be owner-cascading, hashed, bounded and atomic");
      if(/\b(?:purchase_token|raw_token|oauth_token|service_account|order_id|email|phone|address|price|card_number|bank_account)\b/i.test(content))
        errors.push("Play outbox must not persist tokens, prices, credentials or identity");
    }
    if(name===RECEIPT_MIGRATION) {
      // The receipt store is strictly an opaque machine-event lease. Prevent
      // this narrow allowlist from becoming a backdoor for personal identifiers.
      const match=content.match(/CREATE\s+TABLE\s+notification_delivery_receipts\s*\(([\s\S]*?)\)\s*;/i);
      const fields=match===null?[]:[...match[1].matchAll(
        /(?:^|[,(])\s*([a-z][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gim,
      )].map(m=>m[1].toLowerCase());
      if(fields.join(",")!==RECEIPT_FIELDS.join(",") ||
         !/\bCHECK\s*\(/i.test(content) ||
         /\b(?:ALTER|DROP)\s+TABLE\s+notification_delivery_receipts\b/i.test(content))
        errors.push("Notification receipt migration must keep only five bounded machine fields");
    }
    if(name===DEAD_LETTER_MIGRATION) {
      const match=content.match(/CREATE\s+TABLE\s+notification_delivery_dead_letters\s*\(([\s\S]*?)\)\s*;/i);
      const fields=match===null?[]:[...match[1].matchAll(
        /(?:^|[,(])\s*([a-z][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gim,
      )].map(m=>m[1].toLowerCase());
      if(fields.join(",")!==DEAD_LETTER_FIELDS.join(",") ||
         !/\bCHECK\s*\(/i.test(content))
        errors.push("Notification dead-letter migration must keep only three bounded machine fields");
    }
    if(name===AGORA_PREFERENCE_MIGRATION) {
      const match=content.match(/CREATE\s+TABLE\s+worker_agora_call_preferences\s*\(([\s\S]*?)\)\s*;/i);
      const fields=match===null?[]:[...match[1].matchAll(
        /(?:^|[,(])\s*([a-z][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gim,
      )].map(m=>m[1].toLowerCase());
      if(fields.join(",")!==AGORA_PREFERENCE_FIELDS.join(",") ||
         !/REFERENCES\s+worker_profiles\s*\(\s*account_id\s*\)/i.test(content) ||
         !/ON\s+DELETE\s+CASCADE/i.test(content) ||
         !/calls_enabled\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*calls_enabled\s+IN\s*\(\s*0\s*,\s*1\s*\)\s*\)/i.test(content) ||
         !/revision\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(\s*revision\s+BETWEEN\s+1\s+AND\s+2147483647\s*\)/i.test(content))
        errors.push("Agora preference migration must retain only 3 guarded fields and worker owner FK");
    }
    if(name===AGORA_SAFETY_MIGRATION) {
      // Only the minimal account-linked fields explicitly approved for
      // ENGINEERING PREPARATION may appear. No private event log or PII.
      for(const [table,allowedFields] of Object.entries(AGORA_SAFETY_SCHEMA)) {
        const pattern=new RegExp(
          String.raw`CREATE\s+TABLE\s+${table}\s*\(([\s\S]*?)\)\s*;`, "i",
        );
        const match=content.match(pattern);
        const fields=match===null?[]:[...match[1].matchAll(
          /(?:^|[,(])\s*([a-z][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gim,
        )].map(m=>m[1].toLowerCase());
        if(fields.join(",")!==allowedFields.join(",") ||
           !/ON\s+DELETE\s+CASCADE/i.test(match?.[1]??"") ||
           !/CHECK\s*\(/i.test(match?.[1]??"")) {
          errors.push("Private Agora safety table must keep exact bounded fields: "+table);
        }
      }
      if(/\b(?:phone|gps|location|email|call_id|channel|raw_token|device_id|ip_address|message_text|reason_text)\b/i
        .test(content))
        errors.push("Private Agora safety migration added forbidden contact/event data");
    }
    if(/\b(?:ALTER|DROP)\s+TABLE\s+worker_agora_call_preferences\b/i.test(content))
      errors.push("Unauthorized Agora preference schema mutation: "+name);
    for(const table of Object.keys(AGORA_SAFETY_SCHEMA)) {
      const mutations = name === "0016_contact_block_management.sql" && table === "agora_account_blocks"
        ? content.replace(/^ALTER TABLE agora_account_blocks ADD COLUMN management_id TEXT;$/m, "")
        : content;
      if(new RegExp("\\b(?:ALTER|DROP)\\s+TABLE\\s+"+table+"\\b","i").test(mutations))
        errors.push("Unauthorized private Agora safety schema mutation: "+table);
    }
    if(/\b(?:ALTER|DROP)\s+TABLE\s+notification_delivery_dead_letters\b/i.test(content))
      errors.push("Unauthorized notification dead-letter table mutation: "+name);
    if(name!=="0002_shared_accounts_worker_drafts.sql" &&
       /\b(?:ALTER|DROP)\s+TABLE\s+worker_profiles\b/i.test(content))
      errors.push("Unauthorized worker_profiles schema mutation: "+name);
  }
  // Existing synthetic test fixtures represent the pre-hierarchy baseline.
  // The optional hierarchy is only a valid extension if the exact forward
  // migration AND the opt-in router are both present. Fail closed on partial
  // migration/route removal without changing historical fixture contracts.
  const hierarchyTables=["catalog_groups","catalog_families",
    "catalog_family_categories"];
  // Existing founder test fixtures intentionally model pre-billing schemas.
  // Credit tables are optional as a PAIR, not mandatory in old migrations.
  const optionalCreditTables=["call_credit_balances","call_credit_events","play_consume_outbox","play_revocation_fences"];
  for(const table of allowedTables)
    if(table!=="call_history" && table!=="call_attempt_windows" && table!=="private_call_invitations" &&
       table!=="private_call_dispatch_slots" && table!=="private_call_devices" &&
       !optionalCreditTables.includes(table) &&
       !hierarchyTables.includes(table) && !tables.includes(table))
      errors.push("Expected D1 table missing: "+table);
  const hasCreditLedger=migrations.includes(CREDIT_LEDGER_MIGRATION);
  for(const table of ["call_credit_balances","call_credit_events"])
    if(hasCreditLedger !== tables.includes(table))
      errors.push("Credit ledger migration must create both private tables: "+table);
  const hasPlayOutbox=migrations.includes(PLAY_CONSUME_MIGRATION);
  if(hasPlayOutbox !== tables.includes("play_consume_outbox") ||
     (hasPlayOutbox && !hasCreditLedger))
    errors.push("Play consume outbox requires its local migration and existing credit ledger");
  const hasPlayRevocations=migrations.includes(PLAY_REVOCATION_MIGRATION);
  if(hasPlayRevocations !== tables.includes("play_revocation_fences") ||
     (hasPlayRevocations && !hasPlayOutbox))
    errors.push("Play revocation fence must require its local migration and 0025 outbox");
  const hasHierarchy=migrations.includes("0010_approved_catalog_hierarchy.sql");
  const hasHierarchyRoute=routes.includes("/api/v1/catalog/hierarchy");
  if(hasHierarchy) {
    if(!hasHierarchyRoute)errors.push("Reviewed hierarchy migration missing public read route");
    for(const table of hierarchyTables)
      if(!tables.includes(table))errors.push("Reviewed hierarchy table missing: "+table);
    const definition=await required(root,
      "infra/migrations/0010_approved_catalog_hierarchy.sql",errors);
    if(definition!==null) {
      for(const table of hierarchyTables) {
        const statement=definition.match(new RegExp(
          "CREATE\\s+TABLE\\s+"+table+"\\s*\\(([\\s\\S]*?)\\);","i"));
        if(!statement || !/is_approved\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i.test(statement[1]))
          errors.push("Hierarchy approval must default OFF: "+table);
        if(table!=="catalog_family_categories" &&
            (!statement || !/is_active\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i.test(statement[1])))
          errors.push("Hierarchy activation must default OFF: "+table);
      }
      if(/\bINSERT\s+INTO\s+(?:catalog_groups|catalog_families|catalog_family_categories|categories)\b/i.test(definition))
        errors.push("Hierarchy migration must not seed or activate public records");
    }
  }else if(hasHierarchyRoute || hierarchyTables.some(t=>tables.includes(t))) {
    errors.push("Hierarchy route/tables without reviewed forward migration");
  }
  // 0011 is one tightly scoped Worker-listing revision, not permission for a
  // new public profile, personal field, or other live schema migration.
  // Keep baseline synthetic fixture without 0011 valid; if it is introduced,
  // the versioned read+CAS route and the safe trigger are both mandatory.
  const hasServiceCases = migrations.includes("0015_service_reports_and_appeals.sql");
  if (migrations.includes("0016_contact_block_management.sql") !== routes.includes("/api/v1/me/contact-blocks"))
    errors.push("Private contact block management requires both its route and migration");
  if (migrations.includes("0017_private_call_history.sql") !== routes.includes("/api/v1/me/call-history") ||
      tables.includes("call_history") !== routes.includes("/api/v1/me/call-history"))
    errors.push("Private call history requires its route, table and migration");
  if (migrations.includes("0018_call_attempt_windows.sql") !== tables.includes("call_attempt_windows"))
    errors.push("Private call attempt windows require their table and migration");
  if (migrations.includes("0019_private_call_invitations.sql") !== tables.includes("private_call_invitations"))
    errors.push("Private call invitations require their table and migration");
  if (migrations.includes("0020_private_call_dispatch_slots.sql") !== tables.includes("private_call_dispatch_slots"))
    errors.push("Private call dispatch slots require their table and migration");
  const hasCallDevices = migrations.includes(CALL_DEVICE_MIGRATION);
  if (hasCallDevices !== tables.includes("private_call_devices") ||
      hasCallDevices !== routes.includes("/api/v1/me/call-device"))
    errors.push("Private call devices require their scoped route, table and migration");
  const hasCallSignaling = migrations.includes("0022_private_call_signaling.sql");
  for (const route of controlledCallRoutes.keys()) {
    if (route !== "/api/v1/me/call-device" && hasCallSignaling !== routes.includes(route))
      errors.push("Controlled call routes require the signaling migration: " + route);
  }
  if (hasCallSignaling !== migrations.includes("0023_call_history_recording.sql"))
    errors.push("Private call signaling requires the history recording migration");
  if (hasServiceCases !== routes.includes("/api/v1/me/service-report") ||
      hasServiceCases !== routes.includes("/api/v1/me/service-appeal") ||
      hasServiceCases !== routes.includes("/api/v1/moderation/service-cases") ||
      hasServiceCases !== tables.includes("service_report_cases"))
    errors.push("Service reports and appeals require their migration and scoped routes");
  const hasServicePhotos = migrations.includes("0014_reviewed_service_photos.sql");
  if (hasServicePhotos !== routes.includes("/api/v1/me/service-photo") ||
      hasServicePhotos !== routes.includes("/api/v1/moderation/service-photo") ||
      hasServicePhotos !== routes.includes("/api/v1/listings/photo") ||
      hasServicePhotos !== tables.includes("worker_service_photos"))
    errors.push("Reviewed service photos require their migration and scoped routes");
  const hasServiceDetails = migrations.includes("0013_reviewed_service_profiles.sql");
  if (hasServiceDetails !== routes.includes("/api/v1/me/service-details") ||
      hasServiceDetails !== routes.includes("/api/v1/moderation/service-details") ||
      hasServiceDetails !== tables.includes("worker_service_details"))
    errors.push("Reviewed service profiles require their migration and both scoped routes");
  const hasServiceCity = migrations.includes("0012_worker_service_city.sql");
  if (hasServiceCity !== routes.includes("/api/v1/me/service-area"))
    errors.push("Service city migration and private owner route must be present together");
  const hasServiceRevision=migrations.includes("0011_worker_listing_revision.sql");
  const hasRevisionRoute=router!==null &&
    router.includes('mode==="revision"') &&
    router.includes('params.get("revision")');
  if(hasServiceRevision) {
    const sql=await required(root,
      "infra/migrations/0011_worker_listing_revision.sql",errors);
    if(!hasRevisionRoute)
      errors.push("Worker revision migration needs exact private GET and CAS PUT");
    if(sql!==null) {
      const stripped=sql.replace(/--[^\n]*/g,"");
      if(!/ALTER\s+TABLE\s+worker_listings\s+ADD\s+COLUMN\s+revision\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*revision\s+BETWEEN\s+0\s+AND\s+2147483647\s*\)/i.test(stripped))
        errors.push("Worker revision must be only bounded default-zero column");
      if(!/CREATE\s+TRIGGER\s+worker_listing_bump_revision\s+AFTER\s+UPDATE\s+OF\s+category_id\s*,\s*status\s*,\s*moderation_status\s+ON\s+worker_listings/i.test(stripped)||
        !/UPDATE\s+worker_listings\s+SET\s+revision\s*=\s*revision\s*\+\s*1\s+WHERE\s+id\s*=\s*NEW\.id/i.test(stripped)||
        !/OLD\.category_id\s+IS\s+NOT\s+NEW\.category_id/i.test(stripped)||
        !/OLD\.status\s+IS\s+NOT\s+NEW\.status/i.test(stripped)||
        !/OLD\.moderation_status\s+IS\s+NOT\s+NEW\.moderation_status/i.test(stripped))
        errors.push("Worker version trigger must bump all actual old-route changes");
      if(/\b(?:INSERT\s+INTO|DROP\s+TABLE|DELETE\s+FROM)\b/i.test(stripped)||
        /\b(?:phone|gps|address|rate|price|email|identity|verified|description|biography|media|contact)\b/i.test(stripped))
        errors.push("Worker revision migration may not seed or add personal/public fields");
    }
  }else if(hasRevisionRoute) {
    errors.push("Worker versioned route must have forward revision migration");
  }

  // GitHub can execute ANY YAML workflow here; checking checks.yml alone is not enough.
  let workflowFiles=[];
  try {
    for(const entry of await readdir(join(root,".github/workflows"),{withFileTypes:true})) {
      if(!/\.ya?ml$/i.test(entry.name))continue;
      if(!entry.isFile()){
        errors.push("Unsafe CI workflow entry: "+entry.name);
        continue;
      }
      workflowFiles.push(entry.name);
    }
  } catch { errors.push("CI workflows directory unavailable"); }
  for(const name of workflowFiles) {
    const source=name==="checks.yml"?workflow:
      await required(root,".github/workflows/"+name,errors);
    if(source!==null)localOnlyCommands(source,"CI workflow "+name,errors);
  }
  if(pkg!==null) {
    try {
      for(const [key,val] of Object.entries(JSON.parse(pkg).scripts??{}))
        if(typeof val==="string") localOnlyCommands(val,"npm script "+key,errors);
    } catch { errors.push("package.json parsing failed"); }
  }
  let localeDirs=[];
  try {
    const dir=await readdir(join(root,"apps/android/app/src/main/res"),{withFileTypes:true});
    localeDirs=dir.filter(x=>x.isDirectory() && /^values-[a-z]{2}(?:-r[A-Z]{2})?$/.test(x.name))
      .map(x=>x.name);
    for(const locale of localeDirs)
      if(!/^values-(?:hi|en)(?:-r[A-Z]{2})?$/.test(locale))
        errors.push("Unsupported Android locale: "+locale);
  } catch { /* No Android UI until M-004. */ }
  return {errors,routes:[...new Set(routes)],tables,localeDirs};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await auditFounderGates();
  if(result.errors.length) {
    console.error("JODLO founder gates FAILED:\n"+result.errors.join("\n"));
    process.exitCode=1;
  } else console.log("JODLO founder gates OK: routes="+result.routes.length+
    ", tables="+result.tables.length+", draft-only, en|hi, no remote deploy.");
}
