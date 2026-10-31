import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { auditFounderGates } from "./verify-founder-gates.mjs";
const routes=[
  "/api/v1/health", "/api/v1/catalog", "/api/v1/catalog/search",
  "/api/v1/auth/google", "/api/v1/auth/logout", "/api/v1/auth/logout-all",
  "/api/v1/me/worker-profile", "/api/v1/me/listings", "/api/v1/listings",
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
    "infra/migrations/0004_worker_service_listings.sql":"CREATE TABLE worker_listings (id TEXT);",
    "infra/migrations/0003_google_identity_sessions.sql":
      "CREATE TABLE google_identities (id TEXT); CREATE TABLE auth_sessions (id TEXT);",
    "infra/migrations/0005_notification_delivery_receipts.sql":
      "CREATE TABLE notification_delivery_receipts (event_id TEXT, state TEXT, " +
      "claim_token TEXT, lease_until_ms INTEGER, completed_at_ms INTEGER, " +
      "CHECK(state IN ('claimed','completed')));",
    "infra/migrations/0006_notification_dead_letters.sql":
      "CREATE TABLE notification_delivery_dead_letters (event_id TEXT, reason TEXT, " +
      "recorded_at_ms INTEGER, CHECK(reason IN ('PERMANENT_FAILURE','RETRIES_EXHAUSTED')));",
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
  assert.equal(result.routes.length,9);
  assert.equal(result.tables.length,8);
});
test("unapproved workers, requests, area and listing routes fail",async()=>{
  for(const p of ["/api/v1/workers","/api/v1/requests","/api/v1/areas","/api/v1/contact"]){
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
      "CREATE TABLE service_requests (id TEXT); CREATE TABLE contact_records (id TEXT); "+
      "ALTER TABLE worker_profiles ADD COLUMN is_public INTEGER;";
  });
  const errors=result.errors.join(" ");
  assert.match(errors,/Unapproved D1 table: service_requests/);
  assert.match(errors,/Unapproved D1 table: contact_records/);
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

test("every added .yml and .yaml GitHub workflow is audited, not only checks.yml",async()=>{
  const wrong=await fixture(f=>{
    f[".github/workflows/another.yml"]=
      "name: unexpected\nsteps:\n  - run: npx wrangler deploy --config apps/api/wrangler.jsonc\n";
    f[".github/workflows/provision.yaml"]=
      "name: remote\nsteps:\n  - run: wrangler d1 migrations apply database --remote\n";
  });
  assert.match(wrong.errors.join("\n"),/CI workflow another.yml: remote Wrangler deployment/);
  assert.match(wrong.errors.join("\n"),/CI workflow provision.yaml: remote infrastructure/);
  const safe=await fixture(f=>{
    f[".github/workflows/local.yaml"]=
      "name: local checks\nsteps:\n  - run: npx wrangler deploy --dry-run --config apps/api/wrangler.jsonc\n";
  });
  assert.deepEqual(safe.errors,[]);
});
test("a dry-run earlier on the same shell line cannot hide a later real deploy",async()=>{
  const bad=await fixture(f=>{
    f[".github/workflows/checks.yml"]=
      "run: wrangler deploy --dry-run && wrangler deploy --env production\n";
    f["package.json"]=JSON.stringify({scripts:{
      "mixed":"wrangler deploy --dry-run; wrangler deploy --env production",
    }});
  });
  assert.match(bad.errors.join("\n"),/CI workflow checks.yml: remote Wrangler deployment/);
  assert.match(bad.errors.join("\n"),/npm script mixed: remote Wrangler deployment/);
});
test("symlinked workflow files are rejected rather than inspected through a link",async()=>{
  const result=await fixture(null,async root=>{
    await symlink(join(root,"package.json"),join(root,".github/workflows","hidden.yml"));
    return auditFounderGates(root);
  });
  assert.match(result.errors.join("\n"),/Unsafe CI workflow entry: hidden.yml/);
});

test("actual source tree passes narrow founder gate audit",async()=>{
  const result=await auditFounderGates();
  assert.deepEqual(result.errors,[],result.errors.join("\n"));
});

test("notification receipt permission never admits recipient, push token, contact or rogue migration",async()=>{
  for(const extra of [
    "recipient_account_id TEXT", "device_token TEXT", "phone TEXT",
    "location TEXT", "message_body TEXT",
  ]) {
    const result=await fixture(files=>{
      files["infra/migrations/0005_notification_delivery_receipts.sql"]=
        files["infra/migrations/0005_notification_delivery_receipts.sql"]
          .replace("completed_at_ms INTEGER,",
            "completed_at_ms INTEGER, "+extra+",");
    });
    assert.match(result.errors.join("\n"),
      /Notification receipt migration must keep only five bounded machine fields/,extra);
  }
  const altered=await fixture(files=>{
    files["infra/migrations/0005_notification_delivery_receipts.sql"]+=
      "\nALTER TABLE notification_delivery_receipts ADD COLUMN payload TEXT;";
  });
  assert.match(altered.errors.join("\n"),
    /Notification receipt migration must keep only five bounded machine fields/);
  const moved=await fixture(files=>{
    files["infra/migrations/0006_rogue.sql"]=
      "CREATE TABLE notification_delivery_receipts (event_id TEXT);";
  });
  assert.match(moved.errors.join("\n"),
    /Notification receipt table must use its reviewed migration/);
});

test("new dead-letter allowlist cannot add recipient fields, move migration or ALTER table",async()=>{
  for(const extra of ["recipient_account_id TEXT","device_token TEXT","payload BLOB","phone TEXT"]) {
    const wrong=await fixture(f=>{
      f["infra/migrations/0006_notification_dead_letters.sql"]=
        f["infra/migrations/0006_notification_dead_letters.sql"]
          .replace("recorded_at_ms INTEGER,", "recorded_at_ms INTEGER, "+extra+",");
    });
    assert.match(wrong.errors.join("\n"),/Notification dead-letter migration must keep only three bounded machine fields/,extra);
  }
  const moved=await fixture(f=>{
    f["infra/migrations/0007_rogue.sql"]="CREATE TABLE notification_delivery_dead_letters (event_id TEXT);";
  });
  assert.match(moved.errors.join("\n"),/Notification dead-letter table must use its reviewed migration/);
  const altered=await fixture(f=>{
    f["infra/migrations/0007_rogue.sql"]=
      "ALTER TABLE notification_delivery_dead_letters ADD COLUMN recipient_account_id TEXT;";
  });
  assert.match(altered.errors.join("\n"),/Unauthorized notification dead-letter table mutation/);
});
