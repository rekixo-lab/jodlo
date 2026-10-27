import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/http/router.ts";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { findSessionAccount, sessionHash } from "../src/modules/identity/sessions.ts";

const client="12345678901-sandbox.apps.googleusercontent.com";
const origin="https://jodlo.rekixo.com";
const loginPath="/api/v1/auth/google";
const token="synthetic-google-id-token";
const googleSubject="123456789012345678901";
function fixture() {
  const { db, adapter }=openLocalDatabase();
  const env={ DB: adapter, GOOGLE_CLIENT_ID: client };
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
