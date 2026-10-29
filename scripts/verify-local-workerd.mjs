import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** End-to-end LOCAL workerd+D1 HTTP smoke. Never contacts Cloudflare or uses
 * production state, an OAuth client, a real account, or an approved catalog.
 * The fixture and persistence directory are discarded after this invocation.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const config = "apps/api/wrangler.local.jsonc";
const temp = mkdtempSync(join(tmpdir(), "jodlo-workerd-ci-"));
const dataDir = join(temp, "state");
const fixture = join(temp, "synthetic-only.sql");
const baseUrl = "http://127.0.0.1:8797";
const exec = promisify(execFile);
let dev;
let logs = "";

async function runWrangler(args) {
  // Always use the installed repo Wrangler (no npx, network, --remote, or deploy).
  const { stdout, stderr } = await exec(process.execPath, [wrangler, ...args], {
    cwd: root, timeout: 60_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  });
  if (process.env.JODLO_LOCAL_SMOKE_VERBOSE === "1") {
    process.stdout.write(stdout.slice(-3000) + stderr.slice(-3000));
  }
}

async function ready() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (dev.exitCode !== null || dev.signalCode !== null) {
      throw new Error("Local workerd exited before health check: " + logs.slice(-4000));
    }
    try {
      const response = await fetch(baseUrl + "/api/v1/health", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200 && (await response.json()).ok === true) return;
    } catch { /* Local workerd not listening yet; no remote fallback. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Local workerd health timeout: " + logs.slice(-4000));
}
async function get(path, status = 200) {
  const response = await fetch(baseUrl + path, { signal: AbortSignal.timeout(8000) });
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get("Cache-Control"), "no-store", path);
  return response.json();
}

try {
  writeFileSync(fixture, `
-- Deliberately fictional local-only Category IDs, never a pilot activation.
INSERT INTO categories(id,slug,name_en,name_hi,is_active,sort_order) VALUES
 ('synthetic-fixture-active','synthetic-fixture-active','Fixture Plumber','परीक्षण प्लंबर',1,10),
 ('synthetic-fixture-hidden','synthetic-fixture-hidden','Fixture Carpenter','परीक्षण बढ़ई',1,20),
 ('synthetic-fixture-inactive','synthetic-fixture-inactive','Fixture Painter','परीक्षण पेंटर',0,30);
INSERT INTO accounts(id) VALUES ('account-fixture-001'),('account-fixture-002');
INSERT INTO worker_profiles(account_id) VALUES ('account-fixture-001'),('account-fixture-002');
INSERT INTO worker_listings(id,worker_account_id,category_id,moderation_status) VALUES
 ('11111111-1111-4111-8111-111111111111','account-fixture-001','synthetic-fixture-active','allowed'),
 ('22222222-2222-4222-8222-222222222222','account-fixture-002','synthetic-fixture-hidden','hidden');
`, "utf8");

  const local = ["--config", config, "--local", "--persist-to", dataDir];
  await runWrangler(["d1", "migrations", "apply", "jodlo_catalog_local", ...local]);
  await runWrangler(["d1", "execute", "jodlo_catalog_local", ...local, "--file", fixture]);

  dev = spawn(process.execPath, [wrangler, "dev", "--config", config,
    "--local", "--ip", "127.0.0.1", "--port", "8797",
    "--persist-to", dataDir], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  });
  for (const stream of [dev.stdout, dev.stderr]) {
    stream.on("data", bytes => { logs = (logs + bytes.toString("utf8")).slice(-8000); });
  }
  await ready();

  const browse = (await get("/api/v1/catalog?lang=hi")).data.categories;
  assert.deepEqual(browse.map(x => x.id),
    ["synthetic-fixture-active", "synthetic-fixture-hidden"]);
  assert.deepEqual(browse.map(x => x.name), ["परीक्षण प्लंबर", "परीक्षण बढ़ई"]);
  assert.deepEqual((await get("/api/v1/catalog?availableOnly=1")).data.categories
    .map(x => x.id), ["synthetic-fixture-active"]);
  assert.deepEqual((await get("/api/v1/catalog/search?q=Fixture")).data.categories
    .map(x => x.id), ["synthetic-fixture-active", "synthetic-fixture-hidden"]);
  assert.deepEqual((await get("/api/v1/catalog/search?q=Fixture&availableOnly=1"))
    .data.categories.map(x => x.id), ["synthetic-fixture-active"]);

  const visible = (await get("/api/v1/listings?categoryId=synthetic-fixture-active"))
    .data.listings;
  assert.deepEqual(visible, [{
    id: "11111111-1111-4111-8111-111111111111", categoryId: "synthetic-fixture-active",
  }]);
  assert.deepEqual((await get("/api/v1/listings?categoryId=synthetic-fixture-hidden"))
    .data.listings, []);
  assert.deepEqual((await get("/api/v1/listings?categoryId=synthetic-fixture-inactive"))
    .data.listings, []);
  for (const value of ["account-fixture", "moderation", "phone", "verified", "latitude"]) {
    assert.equal(JSON.stringify(visible).includes(value), false, "private leakage: " + value);
  }

  assert.equal((await get("/api/v1/me/listings", 401)).error.code, "UNAUTHORIZED");
  assert.equal((await get("/api/v1/catalog?lang=hinglish", 400)).error.code, "INVALID_QUERY");
  assert.equal((await get("/api/v1/catalog/search?q=Fixture&offset=125", 400))
    .error.code, "INVALID_QUERY");
  // No configured external Google OAuth client means fail-closed even locally.
  const login = await fetch(baseUrl + "/api/v1/auth/google", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "local-fixture-not-google" }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(login.status, 503);
  assert.equal((await login.json()).error.code, "SERVICE_UNAVAILABLE");
  process.stdout.write("Local workerd+D1 HTTP smoke passed (synthetic-only, no remote deployment).\n");
} catch (error) {
  process.stderr.write("Local workerd smoke failed: " + String(error) + "\n" + logs.slice(-4000) + "\n");
  process.exitCode = 1;
} finally {
  if (dev) {
    dev.kill("SIGTERM");
    await Promise.race([
      new Promise(done => dev.once("exit", done)),
      new Promise(done => setTimeout(done, 3000)),
    ]);
    if (dev.exitCode === null && dev.signalCode === null) dev.kill("SIGKILL");
  }
  rmSync(temp, { recursive: true, force: true });
}
