import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

function fixtures() {
  const { db, adapter } = openLocalDatabase();
  for (const id of ["account-owner1", "account-other2"]) {
    db.prepare("INSERT INTO accounts(id) VALUES (?)").run(id);
  }
  const AUTH = {
    async verify(token) {
      if (token === "signed-owner") return { accountId: "account-owner1" };
      if (token === "signed-other") return { accountId: "account-other2" };
      return null;
    },
  };
  return { db, env: { DB: adapter, AUTH } };
}

const url = "https://jodlo.rekixo.com/api/v1/me/worker-profile";
function req(method = "GET", token, more = {}) {
  return new Request(url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...more } });
}

test("worker endpoint is closed without configured trusted verifier or D1", async () => {
  const response = await worker.fetch(req("POST", "signed-owner"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
});

test("server resolves owning account only from trusted verifier, not client headers", async () => {
  const { db, env } = fixtures();
  try {
    const unauthorized = await worker.fetch(req("POST"), env);
    assert.equal(unauthorized.status, 401);
    const forgery = await worker.fetch(req("POST", "forged", { "X-Account-ID": "account-owner1" }), env);
    assert.equal(forgery.status, 401);
    const create = await worker.fetch(req("POST", "signed-owner", { "X-Account-ID": "account-other2" }), env);
    assert.equal(create.status, 200);
    assert.deepEqual(await create.json(), { ok: true, data: { profile: { status: "draft" } } });
    const second = await worker.fetch(req("POST", "signed-owner"), env);
    assert.equal(second.status, 200);
    const stranger = await worker.fetch(req("GET", "signed-other"), env);
    assert.equal(stranger.status, 404);
    const own = await worker.fetch(req("GET", "signed-owner"), env);
    assert.deepEqual(await own.json(), { ok: true, data: { profile: { status: "draft" } } });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 1);
  } finally { db.close(); }
});

test("worker endpoint rejects writes with client JSON, queries and invalid methods", async () => {
  const { db, env } = fixtures();
  try {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await worker.fetch(req(method, "signed-owner"), env);
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("Allow"), "GET, POST");
    }
    const body = await worker.fetch(new Request(url, { method: "POST", headers: { Authorization: "Bearer signed-owner", "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "account-other2", status: "verified" }) }), env);
    assert.equal(body.status, 400);
    const query = await worker.fetch(new Request(url + "?accountId=account-other2", { headers: { Authorization: "Bearer signed-owner" } }), env);
    assert.equal(query.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worker_profiles").get().n, 0);
  } finally { db.close(); }
});

test("disabled actor, malformed identities and auth/database failures fail closed without secret leaks", async () => {
  const { db, env } = fixtures();
  try {
    db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run("account-owner1");
    assert.equal((await worker.fetch(req("POST", "signed-owner"), env)).status, 403);
    assert.equal((await worker.fetch(req("GET", "signed-owner"), env)).status, 404);
    const bad = await worker.fetch(req("POST", "signed-owner"), { ...env, AUTH: { verify: async () => ({ accountId: "bad" }) } });
    assert.equal(bad.status, 401);
    const failing = await worker.fetch(req("POST", "signed-owner"), { ...env, AUTH: { verify: async () => { throw new Error("REAL_PRIVATE_TOKEN"); } } });
    assert.equal(failing.status, 503);
    assert.ok(!(await failing.text()).includes("REAL_PRIVATE_TOKEN"));
    const missingDb = await worker.fetch(req("POST", "signed-owner"), { AUTH: env.AUTH });
    assert.equal(missingDb.status, 503);
  } finally { db.close(); }
});
