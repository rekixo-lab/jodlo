/** Narrow pre-approval CI tripwire, not a security scanner or owner approval. */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoutes = new Set([
  "/api/v1/health", "/api/v1/catalog", "/api/v1/catalog/search",
  "/api/v1/auth/google", "/api/v1/auth/logout", "/api/v1/auth/logout-all",
  "/api/v1/me/worker-profile", "/api/v1/me/listings", "/api/v1/listings",
]);
const allowedTables = new Set([
  "categories", "accounts", "worker_profiles", "google_identities", "auth_sessions", "worker_listings",
]);
async function required(root, path, errors) {
  try { return await readFile(join(root, path), "utf8"); }
  catch { errors.push("Missing required source: " + path); return null; }
}
function localOnlyCommands(text, label, errors) {
  for (const line of text.split("\n")) {
    if (/\bwrangler\s+(?:deploy|publish)\b/i.test(line) && !/--dry-run\b/.test(line))
      errors.push(label + ": remote Wrangler deployment forbidden until M-007");
    if (/\bwrangler\s+(?:d1\s+[^\n]*--remote|pages\s+deploy|secret\s+put)\b/i.test(line) ||
        /\bfirebase\s+deploy\b/i.test(line) ||
        /cloudflare\/(?:wrangler|pages)-action/i.test(line))
      errors.push(label + ": remote infrastructure forbidden until M-007");
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
    if(!routes.includes(route)) errors.push("Previously approved API route missing: " + route);
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
    }
    if(name!=="0002_shared_accounts_worker_drafts.sql" &&
       /\b(?:ALTER|DROP)\s+TABLE\s+worker_profiles\b/i.test(content))
      errors.push("Unauthorized worker_profiles schema mutation: "+name);
  }
  for(const table of allowedTables)
    if(!tables.includes(table)) errors.push("Expected D1 table missing: "+table);
  if(workflow!==null) localOnlyCommands(workflow,"CI workflow",errors);
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
