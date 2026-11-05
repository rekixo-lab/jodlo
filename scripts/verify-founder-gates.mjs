/** Safety checks on CI/npm scripts and unapproved API/data changes.
 * ADR-0015 authorizes operator-controlled Cloudflare/Google onboarding and
 * production deployment, but NEVER auto-deploy on GitHub PR/push workflows.
 * This guard intentionally does not ban protected manual CLI releases.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoutes = new Set([
  "/api/v1/health", "/api/v1/catalog", "/api/v1/catalog/search",
  // Only approved, default-OFF taxonomy hierarchy; no public Worker or GPS.
  "/api/v1/catalog/hierarchy",
  "/api/v1/auth/google", "/api/v1/auth/logout", "/api/v1/auth/logout-all",
  "/api/v1/me/worker-profile", "/api/v1/me/listings", "/api/v1/listings",
  // 2026-11-04: owner-only READs over already-approved JODLO D1 tables.
  // They create no new personal-data fields or external provider side effect.
  // Actual auth/SQL isolation and field redaction are tested separately.
  // This is NOT permission for public profile, account deletion, block or contact APIs.
  "/api/v1/me/overview", "/api/v1/me/data-export",
]);
const allowedTables = new Set([
  "categories",
  // No auto-seed, no public data until human-reviewed Group/Family/mapping approval.
  "catalog_groups", "catalog_families", "catalog_family_categories",
  "accounts", "worker_profiles", "google_identities", "auth_sessions", "worker_listings",
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
    if(!allowedRoutes.has(route)) errors.push("Unapproved API route: " + route + " (M-005/M-003)");
  for(const route of allowedRoutes)
    if(route!=="/api/v1/catalog/hierarchy" && !routes.includes(route))
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
      if(new RegExp("\\b(?:ALTER|DROP)\\s+TABLE\\s+"+table+"\\b","i").test(content))
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
  for(const table of allowedTables)
    if(!hierarchyTables.includes(table) && !tables.includes(table))
      errors.push("Expected D1 table missing: "+table);
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
      const stripped=sql.replace(/--[^\\n]*/g,"");
      if(!/ALTER\\s+TABLE\\s+worker_listings\\s+ADD\\s+COLUMN\\s+revision\\s+INTEGER\\s+NOT\\s+NULL\\s+DEFAULT\\s+0\\s+CHECK\\s*\\(\\s*revision\\s+BETWEEN\\s+0\\s+AND\\s+2147483647\\s*\\)/i.test(stripped))
        errors.push("Worker revision must be only bounded default-zero column");
      if(!/CREATE\\s+TRIGGER\\s+worker_listing_bump_revision\\s+AFTER\\s+UPDATE\\s+OF\\s+category_id\\s*,\\s*status\\s*,\\s*moderation_status\\s+ON\\s+worker_listings/i.test(stripped)||
        !/UPDATE\\s+worker_listings\\s+SET\\s+revision\\s*=\\s*revision\\s*\\+\\s*1\\s+WHERE\\s+id\\s*=\\s*NEW\\.id/i.test(stripped)||
        !/OLD\\.category_id\\s+IS\\s+NOT\\s+NEW\\.category_id/i.test(stripped)||
        !/OLD\\.status\\s+IS\\s+NOT\\s+NEW\\.status/i.test(stripped)||
        !/OLD\\.moderation_status\\s+IS\\s+NOT\\s+NEW\\.moderation_status/i.test(stripped))
        errors.push("Worker version trigger must bump all actual old-route changes");
      if(/\\b(?:INSERT\\s+INTO|DROP\\s+TABLE|DELETE\\s+FROM)\\b/i.test(stripped)||
        /\\b(?:phone|gps|address|rate|price|email|identity|verified|description|biography|media|contact)\\b/i.test(stripped))
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
