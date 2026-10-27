import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import {
  issueSession, findSessionAccount, sessionHash, revokeSession,
  revokeAllSessions, REVOKE_SESSION_QUERY, REVOKE_ALL_SESSIONS_QUERY
} from "../src/modules/identity/sessions.ts";

const A="account-owner1", B="account-other2";
async function fixture() {
  const {db,adapter}=openLocalDatabase();
  await ensureAccount(adapter,A);
  await ensureAccount(adapter,B);
  const issue=async account=>{
    const s=await issueSession(adapter,account);
    assert.ok(s);
    return s.accessToken;
  };
  return {db,adapter,issue};
}
const count=db=>db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n;

test("single-device revocation deletes once; concurrent retries cannot both succeed",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const token=await issue(A);
    assert.equal(count(db),1);
    const values=await Promise.all([revokeSession(adapter,token),revokeSession(adapter,token)]);
    assert.deepEqual(values.filter(Boolean),[true]);
    assert.deepEqual(values.filter(v=>!v),[false]);
    assert.equal(count(db),0);
    assert.equal(await findSessionAccount(adapter,token),null);
    assert.equal(await revokeSession(adapter,token),false);
  } finally {db.close();}
});

test("single-device revocation never revokes the other device or other account",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const first=await issue(A), sibling=await issue(A), other=await issue(B);
    assert.equal(await revokeSession(adapter,first),true);
    assert.equal(await findSessionAccount(adapter,first),null);
    assert.equal(await findSessionAccount(adapter,sibling),A);
    assert.equal(await findSessionAccount(adapter,other),B);
    assert.equal(count(db),2);
  } finally {db.close();}
});

test("logout-all revokes only caller's account atomically; replay and racing caller rejected",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const a1=await issue(A), a2=await issue(A), a3=await issue(A), b=await issue(B);
    const result=await Promise.all([revokeAllSessions(adapter,a1),revokeAllSessions(adapter,a2)]);
    assert.equal(result.filter(Boolean).length,1);
    assert.equal(result.filter(v=>!v).length,1);
    for(const t of [a1,a2,a3]) assert.equal(await findSessionAccount(adapter,t),null);
    assert.equal(await findSessionAccount(adapter,b),B);
    assert.equal(count(db),1);
    assert.equal(await revokeAllSessions(adapter,a1),false);
  } finally {db.close();}
});

test("expired and disabled credentials never authorize any deletion",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const expired=await issue(A), healthy=await issue(A), other=await issue(B);
    db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?")
      .run(await sessionHash(expired));
    assert.equal(await revokeSession(adapter,expired),false);
    assert.equal(await revokeAllSessions(adapter,expired),false);
    assert.equal(await findSessionAccount(adapter,healthy),A);
    db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(A);
    assert.equal(await revokeSession(adapter,healthy),false);
    assert.equal(await revokeAllSessions(adapter,healthy),false);
    assert.equal(count(db),3);
    assert.equal(await findSessionAccount(adapter,other),B);
    assert.equal(await revokeAllSessions(adapter,other),true);
    assert.equal(count(db),2);
  } finally {db.close();}
});

test("malformed, unknown and forged bearer shapes cannot delete another session",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const token=await issue(A);
    for(const candidate of ["short","invalid;DROP",token+"x","A".repeat(43),"",null]) {
      assert.equal(await revokeSession(adapter,candidate),false);
      assert.equal(await revokeAllSessions(adapter,candidate),false);
    }
    assert.equal(count(db),1);
    assert.equal(await findSessionAccount(adapter,token),A);
  } finally {db.close();}
});

test("logout paths issue exactly one conditional DELETE each, not a separate preflight read",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const first=await issue(A), second=await issue(A);
    const sqls=[];
    const traced={...adapter,prepare(query){sqls.push(query);return adapter.prepare(query);}};
    assert.equal(await revokeSession(traced,first),true);
    assert.deepEqual(sqls,[REVOKE_SESSION_QUERY]);
    sqls.length=0;
    assert.equal(await revokeAllSessions(traced,second),true);
    assert.deepEqual(sqls,[REVOKE_ALL_SESSIONS_QUERY]);
  } finally {db.close();}
});

test("conditional logout queries are parameterized, index-backed, and never use identity from client",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    assert.equal((REVOKE_SESSION_QUERY.match(/\?/g)??[]).length,2);
    assert.equal((REVOKE_ALL_SESSIONS_QUERY.match(/\?/g)??[]).length,2);
    assert.equal(REVOKE_SESSION_QUERY.includes(A),false);
    assert.equal(REVOKE_ALL_SESSIONS_QUERY.includes(A),false);
    for(const query of [REVOKE_SESSION_QUERY,REVOKE_ALL_SESSIONS_QUERY]){
      const plan=db.prepare("EXPLAIN QUERY PLAN "+query).all("a".repeat(64),10);
      assert.ok(plan.length>0);
      assert.ok(plan.some(p=>/sqlite_autoindex_auth_sessions_1|auth_sessions/.test(String(p.detail))),JSON.stringify(plan));
    }
    const token=await issue(A);
    assert.equal(await revokeSession(adapter,token),true);
    assert.equal(db.prepare("SELECT token_hash FROM auth_sessions").all().length,0);
  } finally {db.close();}
});

test("existing authenticated HTTP logout remains sanitized, preserves status contract",async()=>{
  const {db,adapter,issue}=await fixture();
  try {
    const first=await issue(A),second=await issue(A),other=await issue(B);
    const env={DB:adapter};
    const url="https://jodlo.rekixo.com/api/v1/auth/";
    const req=(endpoint,t)=>new Request(url+endpoint,{
      method:"POST",headers:{Authorization:"Bearer "+t}
    });
    assert.equal((await worker.fetch(req("logout",first),env)).status,200);
    const repeat=await worker.fetch(req("logout",first),env);
    assert.equal(repeat.status,401);
    assert.equal((await repeat.text()).includes(first),false);
    assert.equal((await worker.fetch(req("logout-all",second),env)).status,200);
    assert.equal(await findSessionAccount(adapter,other),B);
    assert.equal(count(db),1);
  } finally {db.close();}
});
