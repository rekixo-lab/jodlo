import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { auditFounderGates } from "./verify-founder-gates.mjs";
const routes=[
  "/api/v1/health", "/api/v1/catalog", "/api/v1/catalog/search",
  "/api/v1/auth/google", "/api/v1/auth/logout", "/api/v1/auth/logout-all",
  "/api/v1/me/worker-profile",
];
function baseline() {
  return {
    "apps/api/src/http/router.ts":routes.map(p=>'if(url.pathname==="'+p+'") return;').join("\n"),
    "apps/api/src/modules/catalog/catalog.ts":'export type CatalogLanguage = "en" | "hi";',
    "apps/api/src/modules/catalog/search-phrases.ts":
      "const HINDI_GRAMMAR=[]; const ENGLISH_GRAMMAR=[]; if (hasHindi && hasEnglish) return [];",
    "infra/migrations/0001_public_catalog.sql":"CREATE TABLE categories (id TEXT);",
    "infra/migrations/0002_shared_accounts_worker_drafts.sql":
      "CREATE TABLE accounts (id TEXT); CREATE TABLE worker_profiles (status TEXT NOT NULL DEFAULT 'draft' CHECK(status = 'draft'));",
    "infra/migrations/0003_google_identity_sessions.sql":
      "CREATE TABLE google_identities (id TEXT); CREATE TABLE auth_sessions (id TEXT);",
    "docs/decisions/0008-hindi-english-only.md":"Hinglish is NOT a supported language",
    ".github/workflows/checks.yml":"run: npm run build:api",
    "package.json":JSON.stringify({scripts:{"build:api":"wrangler deploy --dry-run --config apps/api/wrangler.jsonc"}}),
  };
}
async function fixture(mutate,action=auditFounderGates) {
  const root=await mkdtemp(join(tmpdir(),"jodlo-founder-"));
  try {
    const files=baseline();
    if(mutate) mutate(files);
    for(const [name,body] of Object.entries(files)) {
      const path=join(root,name);
      await mkdir(dirname(path),{recursive:true});
      await writeFile(path,body);
    }
    return await action(root);
  } finally { await rm(root,{recursive:true,force:true}); }
}
test("approved routes, tables, draft state and languages pass",async()=>{
  const result=await fixture();
  assert.deepEqual(result.errors,[]);
  assert.equal(result.routes.length,7);
  assert.equal(result.tables.length,5);
});
test("unapproved workers, requests, area and listing routes fail",async()=>{
  for(const p of ["/api/v1/workers","/api/v1/requests","/api/v1/areas","/api/v1/listings"]){
    const result=await fixture(f=>{f["apps/api/src/http/router.ts"]+='\nif(url.pathname==="'+p+'")return;';});
    assert.ok(result.errors.some(e=>e.includes("Unapproved API route: "+p)),p);
  }
});
test("missing/removed route is flagged",async()=>{
  const gone=await fixture(f=>{
    f["apps/api/src/http/router.ts"]=f["apps/api/src/http/router.ts"]
      .replace('if(url.pathname==="/api/v1/health") return;',"");
  });
  assert.match(gone.errors.join(" "),/Previously approved API route missing/);
  const missing=await fixture(f=>{delete f["apps/api/src/http/router.ts"];});
  assert.match(missing.errors.join(" "),/Missing required source/);
});
test("worker SQL draft-only CHECK cannot be relaxed",async()=>{
  const result=await fixture(f=>{
    f["infra/migrations/0002_shared_accounts_worker_drafts.sql"]=
      "CREATE TABLE accounts (id TEXT); CREATE TABLE worker_profiles (status TEXT DEFAULT 'published');";
  });
  assert.match(result.errors.join(" "),/Draft-only worker profile SQL CHECK/);
});
test("new operational table or alteration of worker schema fails",async()=>{
  const result=await fixture(f=>{
    f["infra/migrations/0004_unapproved.sql"]=
      "CREATE TABLE service_requests (id TEXT); CREATE TABLE worker_listings (id TEXT); "+
      "ALTER TABLE worker_profiles ADD COLUMN is_public INTEGER;";
  });
  const errors=result.errors.join(" ");
  assert.match(errors,/Unapproved D1 table: service_requests/);
  assert.match(errors,/Unapproved D1 table: worker_listings/);
  assert.match(errors,/Unauthorized worker_profiles schema mutation/);
});
test("third locale and Roman Hindi grammar fail",async()=>{
  const r=await fixture(f=>{
    f["apps/api/src/modules/catalog/catalog.ts"]=
      'export type CatalogLanguage = "en" | "hi" | "fr";';
    f["apps/api/src/modules/catalog/search-phrases.ts"]+='\nconst roman=["mujhe","kaam"];';
  });
  assert.match(r.errors.join(" "),/Catalog locales must be exactly en\|hi/);
  assert.match(r.errors.join(" "),/Unsupported Romanized Hindi/);
});
test("CI/scripts remote deploy refused but Wrangler --dry-run allowed",async()=>{
  const wrong=await fixture(f=>{
    f["package.json"]=JSON.stringify({scripts:{deploy:"wrangler deploy --config apps/api/wrangler.jsonc"}});
    f[".github/workflows/checks.yml"]="run: wrangler d1 migrations apply db --remote";
  });
  assert.match(wrong.errors.join(" "),/remote Wrangler deployment/);
  assert.match(wrong.errors.join(" "),/remote infrastructure/);
  assert.deepEqual((await fixture()).errors,[]);
});
test("Android locale resources allow hi/en and disallow third language",async()=>{
  const out=await fixture(null,async root=>{
    await mkdir(join(root,"apps/android/app/src/main/res/values-en"),{recursive:true});
    await mkdir(join(root,"apps/android/app/src/main/res/values-hi"),{recursive:true});
    assert.deepEqual((await auditFounderGates(root)).errors,[]);
    await mkdir(join(root,"apps/android/app/src/main/res/values-fr"),{recursive:true});
    return auditFounderGates(root);
  });
  assert.match(out.errors.join(" "),/Unsupported Android locale: values-fr/);
});
test("actual source tree passes narrow founder gate audit",async()=>{
  const result=await auditFounderGates();
  assert.deepEqual(result.errors,[],result.errors.join("\n"));
});
