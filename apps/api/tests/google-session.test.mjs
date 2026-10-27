import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/http/router.ts";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { findSessionAccount, sessionHash, MAX_ACTIVE_SESSIONS, PRUNE_EXPIRED_QUERY, INSERT_BOUNDED_SESSION_QUERY } from "../src/modules/identity/sessions.ts";

const client="12345678901-sandbox.apps.googleusercontent.com";
const origin="https://jodlo.rekixo.com";
const loginPath="/api/v1/auth/google";
const token="synthetic-google-id-token";
const googleSubject="123456789012345678901";
function fixture() {
  const { db, adapter }=openLocalDatabase();
  const allow = { async limit() { return { success: true }; } };
  const env={ DB: adapter, GOOGLE_CLIENT_ID: client,
    LOGIN_BURST_LIMITER: allow, ACCOUNT_LOGIN_LIMITER: allow };
  let verified=0;
  async function fakeGoogle(value,aud) {
    verified++;
    assert.equal(aud,client);
    return value===token ? googleSubject : null;
  }
  return {db,env,fakeGoogle,getVerified:()=>verified};
}
function req(path,method="GET",tokenHeader,body) {
  return new Request(origin+path,{
    method, headers:{...(tokenHeader?{Authorization:"Bearer "+tokenHeader}:{}),...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
}
const postLogin=(env,google)=>handleRequest(req(loginPath,"POST",undefined,{idToken:token}),env,google);

test("Google sign-in binds stable subject exactly once and returns random one-hour session",async()=>{
  const {db,env,fakeGoogle}=fixture();
  try {
    const first=await postLogin(env,fakeGoogle);
    assert.equal(first.status,200);
    const body=await first.json();
    assert.equal(body.ok,true);
    assert.equal(body.data.tokenType,"Bearer");
    assert.equal(body.data.expiresInSeconds,3600);
    assert.match(body.data.accessToken,/^[A-Za-z0-9_-]{43}$/);
    const subjectCount=db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n;
    assert.equal(subjectCount,1);
    const accountCount=db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;
    assert.equal(accountCount,1);
    const same=await postLogin(env,fakeGoogle);
    const second=await same.json();
    assert.notEqual(second.data.accessToken,body.data.accessToken);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n,2);
    const stored=db.prepare("SELECT token_hash FROM auth_sessions").all().map(x=>x.token_hash);
    assert.equal(stored.includes(body.data.accessToken),false);
    assert.ok(stored.includes(await sessionHash(body.data.accessToken)));
    const owner=await findSessionAccount(env.DB,body.data.accessToken);
    assert.match(owner,/^[a-z0-9-]{36}$/);
    const workerProfile=await worker.fetch(req("/api/v1/me/worker-profile","POST",body.data.accessToken),env);
    assert.equal(workerProfile.status,200);
    assert.deepEqual((await workerProfile.json()).data.profile,{status:"draft"});
    const logout=await worker.fetch(req("/api/v1/auth/logout","POST",body.data.accessToken),env);
    assert.equal(logout.status,200);
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","GET",body.data.accessToken),env)).status,401);
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","GET",second.data.accessToken),env)).status,200);
  } finally { db.close(); }
});

test("two simultaneous first Google logins link to one stable account without orphan rows", async()=>{
  const {db,env,fakeGoogle}=fixture();
  try {
    const responses=await Promise.all([postLogin(env,fakeGoogle),postLogin(env,fakeGoogle)]);
    assert.deepEqual(responses.map(r=>r.status),[200,200]);
    const sessions=await Promise.all(responses.map(r=>r.json()));
    assert.notEqual(sessions[0].data.accessToken,sessions[1].data.accessToken);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n,2);
  } finally {db.close();}
});

test("login denied without configuration, malformed/unknown credentials and unsolicited fields", async()=>{
  const {db,env,fakeGoogle,getVerified}=fixture();
  try{
    assert.equal((await worker.fetch(req(loginPath,"POST",undefined,{idToken:token}))).status,503);
    assert.equal((await worker.fetch(req(loginPath,"POST",undefined,{idToken:token}),{DB:env.DB})).status,503);
    assert.equal((await handleRequest(req(loginPath,"POST",undefined,{idToken:"fake"}),env,fakeGoogle)).status,401);
    assert.equal((await handleRequest(req(loginPath,"POST",undefined,{idToken:token,accountId:"account-attacker"}),env,fakeGoogle)).status,400);
    assert.equal((await handleRequest(req(loginPath+"?role=admin","POST",undefined,{idToken:token}),env,fakeGoogle)).status,400);
    assert.equal((await handleRequest(req(loginPath,"GET"),env,fakeGoogle)).status,405);
    const nonJson=new Request(origin+loginPath,{method:"POST",body:token,headers:{"Content-Type":"text/plain"}});
    assert.equal((await handleRequest(nonJson,env,fakeGoogle)).status,400);
    assert.equal(getVerified(),1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,0);
  }finally{db.close();}
});

test("cross-account sessions isolate private worker drafts, expiry and disable block access",async()=>{
  const {db,env,fakeGoogle}=fixture();
  try {
    const owner=(await (await postLogin(env,fakeGoogle)).json()).data.accessToken;
    const other=(await (await handleRequest(req(loginPath,"POST",undefined,{idToken:"other"}),env,async()=> "456789012345678901")).json()).data.accessToken;
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","POST",owner),env)).status,200);
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","GET",other),env)).status,404);
    db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?").run(await sessionHash(owner));
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","GET",owner),env)).status,401);
    assert.equal((await worker.fetch(req("/api/v1/auth/logout","POST",owner),env)).status,401);
    db.prepare("UPDATE accounts SET status='disabled' WHERE id=(SELECT account_id FROM auth_sessions WHERE token_hash=?)").run(await sessionHash(other));
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile","GET",other),env)).status,401);
    const blocked=await postLogin(env,fakeGoogle);
    // Owner is active, expired session does not block fresh Google proof.
    assert.equal(blocked.status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n,2);
  }finally {db.close();}
});

test("failed batch never leaves orphan account; unknown provider/disabling prevents new sessions",async()=>{
  const {db,env,fakeGoogle}=fixture();
  try{
    const failEnv={...env,DB:{...env.DB,batch:async()=>{throw Error("INTERNAL_SQL_SECRET")}}};
    const response=await postLogin(failEnv,fakeGoogle);
    assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes("INTERNAL_SQL_SECRET"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,0);
    await postLogin(env,fakeGoogle);
    db.prepare("UPDATE accounts SET status='disabled'").run();
    const disabled=await postLogin(env,fakeGoogle);
    assert.equal(disabled.status,403);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n,1);
  }finally{db.close();}
});

test("strict JSON size, logout method and duplicate/unknown bearer tokens rejected",async()=>{
  const {db,env,fakeGoogle}=fixture();
  try{
    const huge=new Request(origin+loginPath,{method:"POST",body:JSON.stringify({idToken:"A".repeat(9000)}),headers:{"Content-Type":"application/json"}});
    assert.equal((await handleRequest(huge,env,fakeGoogle)).status,400);
    assert.equal((await worker.fetch(req("/api/v1/auth/logout","GET"),env)).status,405);
    assert.equal((await worker.fetch(req("/api/v1/auth/logout","POST","not-a-real-token"),env)).status,401);
    const raw=new Request(origin+"/api/v1/auth/logout",{method:"POST",headers:{Authorization:"Bearer invalid", "Content-Type":"application/json"},body:"{}"});
    assert.equal((await worker.fetch(raw,env)).status,400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,0);
  }finally{db.close();}
});

test("session issuance is atomically capped even under concurrent Google logins", async () => {
  const { db, env, fakeGoogle } = fixture();
  try {
    const attempts = await Promise.all(Array.from({ length: MAX_ACTIVE_SESSIONS + 4 },
      () => postLogin(env, fakeGoogle)));
    assert.equal(attempts.filter(r => r.status === 200).length, MAX_ACTIVE_SESSIONS);
    assert.equal(attempts.filter(r => r.status === 429).length, 4);
    assert.ok(attempts.filter(r => r.status === 429).every(r => r.headers.get("Retry-After") === "3600"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, MAX_ACTIVE_SESSIONS);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
    const payloads = await Promise.all(attempts.filter(r => r.status === 200).map(r => r.json()));
    assert.equal(new Set(payloads.map(x => x.data.accessToken)).size, MAX_ACTIVE_SESSIONS);
    const before = await postLogin(env, fakeGoogle);
    assert.equal(before.status, 429);
    const logout = await worker.fetch(req("/api/v1/auth/logout", "POST", payloads[0].data.accessToken), env);
    assert.equal(logout.status, 200);
    assert.equal((await postLogin(env, fakeGoogle)).status, 200);
  } finally { db.close(); }
});

test("expiry cleanup is bounded, index-backed, and no longer blocks new valid sessions", async () => {
  const { db, env, fakeGoogle } = fixture();
  try {
    const plan = db.prepare("EXPLAIN QUERY PLAN " + PRUNE_EXPIRED_QUERY).all(100, 100);
    assert.ok(plan.some(p => String(p.detail).includes("idx_auth_sessions_expiry")), JSON.stringify(plan));
    const insertPlan = db.prepare("EXPLAIN QUERY PLAN " + INSERT_BOUNDED_SESSION_QUERY)
      .all("a".repeat(64), "account-owner1", 9999999999, 100, MAX_ACTIVE_SESSIONS);
    assert.ok(insertPlan.length > 0);
    const first = await postLogin(env, fakeGoogle);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    db.prepare("UPDATE auth_sessions SET expires_at = 1").run();
    for (let i=0; i<105; i++) {
      db.prepare("INSERT INTO auth_sessions(token_hash, account_id, expires_at) VALUES (?, ?, 1)")
        .run(i.toString(16).padStart(64, "0"), db.prepare("SELECT id FROM accounts").get().id);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 106);
    assert.equal((await postLogin(env, fakeGoogle)).status, 200);
    // Only 100 expired rows pruned per successful sign-in, no global background job.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at <= 1").get().n, 6);
    assert.equal(await findSessionAccount(env.DB, firstBody.data.accessToken), null);
    assert.equal((await postLogin(env, fakeGoogle)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at <= 1").get().n, 0);
  } finally { db.close(); }
});

test("logout-all revokes only the authenticated account across all sessions", async () => {
  const { db, env, fakeGoogle } = fixture();
  try {
    const first = (await (await postLogin(env, fakeGoogle)).json()).data.accessToken;
    const second = (await (await postLogin(env, fakeGoogle)).json()).data.accessToken;
    const other = (await (await handleRequest(req(loginPath, "POST", undefined, { idToken: "other" }),
      env, async () => "456789012345678901")).json()).data.accessToken;
    const noToken = await worker.fetch(req("/api/v1/auth/logout-all", "POST"), env);
    assert.equal(noToken.status, 401);
    const wrongMethod = await worker.fetch(req("/api/v1/auth/logout-all", "GET", first), env);
    assert.equal(wrongMethod.status, 405);
    const forged = await worker.fetch(new Request(origin + "/api/v1/auth/logout-all", {
      method: "POST", headers: { Authorization: "Bearer " + first, "X-Account-ID": "account-other2" }
    }), env);
    assert.deepEqual(await forged.json(), { ok: true, data: { revoked: true, allDevices: true } });
    assert.equal(await findSessionAccount(env.DB, first), null);
    assert.equal(await findSessionAccount(env.DB, second), null);
    assert.notEqual(await findSessionAccount(env.DB, other), null);
    assert.equal((await worker.fetch(req("/api/v1/me/worker-profile", "GET", second), env)).status, 401);
    assert.equal((await worker.fetch(req("/api/v1/auth/logout-all", "POST", first), env)).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 1);
  } finally { db.close(); }
});

test("disabled account cannot issue new session, and failed D1 cleanup fails closed", async () => {
  const { db, env, fakeGoogle } = fixture();
  try {
    await postLogin(env, fakeGoogle);
    db.prepare("UPDATE accounts SET status = 'disabled'").run();
    assert.equal((await postLogin(env, fakeGoogle)).status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 1);
    db.prepare("UPDATE accounts SET status = 'active'").run();
    const failing = { ...env, DB: { ...env.DB, prepare(query) {
      if (query === PRUNE_EXPIRED_QUERY) return { bind() { return { run: async () => { throw new Error("SECRET_SQL_INTERNAL"); } }; } };
      return env.DB.prepare(query);
    } } };
    const error = await postLogin(failing, fakeGoogle);
    assert.equal(error.status, 503);
    assert.ok(!(await error.text()).includes("SECRET_SQL_INTERNAL"));
  } finally { db.close(); }
});


test("missing admission bindings fail closed without checking Google or creating identities", async () => {
  const { db, env, fakeGoogle, getVerified } = fixture();
  try {
    const missingBurst = await postLogin({ ...env, LOGIN_BURST_LIMITER: undefined }, fakeGoogle);
    const missingAccount = await postLogin({ ...env, ACCOUNT_LOGIN_LIMITER: undefined }, fakeGoogle);
    assert.equal(missingBurst.status, 503);
    assert.equal(missingAccount.status, 503);
    assert.equal(getVerified(), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM google_identities").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 0);
  } finally { db.close(); }
});

test("coarse pre-verification gate returns 429 before Google signature work and D1 access", async () => {
  const { db, env, fakeGoogle, getVerified } = fixture();
  try {
    const keys = [];
    const limitedEnv = { ...env, LOGIN_BURST_LIMITER: {
      async limit({ key }) { keys.push(key); return { success: false }; },
    } };
    const response = await postLogin(limitedEnv, fakeGoogle);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "10");
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(getVerified(), 0);
    assert.deepEqual(keys, ["google:login:unverified"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
  } finally { db.close(); }
});

test("verified subject gate uses hashed server-resolved key and never stores rejected account", async () => {
  const { db, env, fakeGoogle, getVerified } = fixture();
  try {
    const seen = [];
    const limitedEnv = { ...env, ACCOUNT_LOGIN_LIMITER: {
      async limit({ key }) { seen.push(key); return { success: false }; },
    } };
    const one = await postLogin(limitedEnv, fakeGoogle);
    const two = await postLogin(limitedEnv, fakeGoogle);
    assert.equal(one.status, 429);
    assert.equal(one.headers.get("Retry-After"), "60");
    assert.equal((await two.json()).error.code, "RATE_LIMITED");
    assert.equal(getVerified(), 2);
    assert.deepEqual(seen.length, 2);
    assert.equal(seen[0], seen[1]);
    assert.match(seen[0], /^google:verified:[a-f0-9]{64}$/);
    assert.equal(seen[0].includes(googleSubject), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 0);
  } finally { db.close(); }
});

test("rate-limiter errors or malformed decisions yield sanitized 503 without fallback", async () => {
  const { db, env, fakeGoogle, getVerified } = fixture();
  try {
    const failing = { async limit() { throw new Error("RAW_LIMITER_SECRET"); } };
    const malformed = { async limit() { return {}; } };
    for (const overrides of [
      { LOGIN_BURST_LIMITER: failing },
      { LOGIN_BURST_LIMITER: malformed },
      { ACCOUNT_LOGIN_LIMITER: failing },
      { ACCOUNT_LOGIN_LIMITER: malformed },
    ]) {
      const response = await postLogin({ ...env, ...overrides }, fakeGoogle);
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes("RAW_LIMITER_SECRET"), false);
    }
    assert.equal(getVerified(), 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
  } finally { db.close(); }
});

test("admission controls use two distinct keys without depending on IP or spoofed headers", async () => {
  const { db, env, fakeGoogle } = fixture();
  try {
    const before = [], after = [];
    const observed = { ...env,
      LOGIN_BURST_LIMITER: { async limit({ key }) { before.push(key); return { success: true }; } },
      ACCOUNT_LOGIN_LIMITER: { async limit({ key }) { after.push(key); return { success: true }; } },
    };
    const crafted = req(loginPath, "POST", undefined, { idToken: token });
    crafted.headers.set("CF-Connecting-IP", "1.2.3.4");
    crafted.headers.set("X-Forwarded-For", "5.6.7.8");
    const result = await handleRequest(crafted, observed, fakeGoogle);
    assert.equal(result.status, 200);
    assert.deepEqual(before, ["google:login:unverified"]);
    assert.match(after[0], /^google:verified:[0-9a-f]{64}$/);
    assert.ok(!after[0].includes("1.2.3.4") && !after[0].includes("5.6.7.8"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 1);
  } finally { db.close(); }
});
