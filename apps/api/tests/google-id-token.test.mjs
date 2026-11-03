import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { validGoogleClientId, verifyGoogleIdToken } from "../src/modules/identity/google.ts";
import { handleRequest } from "../src/http/router.ts";
import { openLocalDatabase } from "./helpers/local-db.mjs";

const client = "12345678901-sandbox.apps.googleusercontent.com";
const sub = "123456789012345678901";
async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "synthetic-rsa", alg: "RS256", use: "sig" };
  return {
    resolver: createLocalJWKSet({ keys: [jwk] }),
    token: async (overrides = {}, protectedHeader = { alg: "RS256", kid: "synthetic-rsa" }) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        sub, iss: "https://accounts.google.com", aud: client, iat: now,
        exp: now + 1800, ...overrides,
      }).setProtectedHeader(protectedHeader).sign(privateKey);
    },
  };
}

test("verified RSA Google JWT returns only stable subject, not email/profile", async () => {
  const { resolver, token } = await signer();
  assert.equal(await verifyGoogleIdToken(await token({ email: "changed@example.org", email_verified: true }), client, resolver), sub);
  assert.equal(await verifyGoogleIdToken(await token({ iss: "accounts.google.com" }), client, resolver), sub);
  assert.equal(validGoogleClientId(client), true);
  assert.equal(validGoogleClientId("test"), false);
});

test("wrong audience, issuer, expired, future-issued, invalid sub and fake payload are denied", async () => {
  const { resolver, token } = await signer();
  const now = Math.floor(Date.now()/1000);
  for (const overrides of [
    { aud: "hijacker.apps.googleusercontent.com" },
    { iss: "https://evil.example" },
    { exp: now - 20 },
    { iat: now + 300 },
    { iat: now - 7200 },
    { sub: "" },
    { sub: "notnumeric" },
  ]) {
    assert.equal(await verifyGoogleIdToken(await token(overrides), client, resolver), null, JSON.stringify(overrides));
  }
  assert.equal(await verifyGoogleIdToken("a.b.c", client, resolver), null);
});

test("tampered signature and untrusted JWKS key/algorithm cannot impersonate", async () => {
  const { resolver, token } = await signer();
  const genuine = await token();
  const parts = genuine.split(".");
  const mutated = parts[1].slice(0,-1)+(parts[1].endsWith("A")?"B":"A");
  assert.equal(await verifyGoogleIdToken([parts[0],mutated,parts[2]].join("."),client,resolver),null);
  const other = await signer();
  assert.equal(await verifyGoogleIdToken(genuine, client, other.resolver),null);
  assert.equal(await verifyGoogleIdToken(genuine, "wrong", resolver),null);
});

test("missing required claims, invalid tokens and resolver outage fail closed", async () => {
  const { resolver, token } = await signer();
  assert.equal(await verifyGoogleIdToken(await token({ exp: undefined }), client, resolver),null);
  assert.equal(await verifyGoogleIdToken("not.jwt", client, resolver),null);
  await assert.rejects(verifyGoogleIdToken(await token(), client, async()=>{throw Error("OFFLINE")}),/OFFLINE/);
});


test("OIDC authorized-party must match JODLO's sole configured client", async () => {
  const { resolver, token } = await signer();
  const other = "12345678901-unapproved.apps.googleusercontent.com";
  assert.equal(await verifyGoogleIdToken(await token({ azp: client }),client,resolver),sub);
  for(const azp of [other, "", null, 123, true, {client}]) {
    assert.equal(await verifyGoogleIdToken(await token({ azp }),client,resolver),
      null, "rejected azp="+JSON.stringify(azp));
  }
  // Omission is valid for the usual single-client Google ID token.
  assert.equal(await verifyGoogleIdToken(await token(),client,resolver),sub);
});

test("Google Android authorized-party requires exact approved Android ID and web audience", async () => {
  const { resolver, token } = await signer();
  const android = "12345678901-jodloandroid.apps.googleusercontent.com";
  const unrelated = "12345678901-unapproved.apps.googleusercontent.com";
  const proof = await token({ azp: android });
  assert.equal(await verifyGoogleIdToken(proof, client, resolver), null,
    "Android azp must be denied without an explicit operator binding");
  assert.equal(await verifyGoogleIdToken(proof, client, resolver, unrelated), null);
  assert.equal(await verifyGoogleIdToken(proof, client, resolver, "malformed"), null);
  assert.equal(await verifyGoogleIdToken(proof, client, resolver, android), sub);
  assert.equal(await verifyGoogleIdToken(await token({ azp: client }), client, resolver, android), sub);
  assert.equal(await verifyGoogleIdToken(await token(), client, resolver, android), sub);
  assert.equal(await verifyGoogleIdToken(await token({ azp: unrelated }), client, resolver, android), null);
  assert.equal(await verifyGoogleIdToken(await token({ aud: unrelated, azp: android }),
    client, resolver, android), null);
  assert.equal(await verifyGoogleIdToken(await token({ aud: [client, unrelated], azp: android }),
    client, resolver, android), null);
});

test("HTTP Google login with approved Android azp creates a session; without binding fails closed", async () => {
  const { resolver, token } = await signer();
  const android = "12345678901-jodloandroid.apps.googleusercontent.com";
  const proof = await token({ azp: android });
  const { db, adapter } = openLocalDatabase();
  const allow = { async limit() { return { success: true }; } };
  const env = {
    DB: adapter, GOOGLE_CLIENT_ID: client,
    LOGIN_BURST_LIMITER: allow, ACCOUNT_LOGIN_LIMITER: allow,
  };
  const verifier = (jwt, aud, _keys, approvedAndroid) =>
    verifyGoogleIdToken(jwt, aud, resolver, approvedAndroid);
  const login = (config) => handleRequest(new Request("https://api.jodlo.rekixo.com/api/v1/auth/google", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: proof }),
  }), config, verifier);
  try {
    assert.equal((await login(env)).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
    const ok = await login({ ...env, GOOGLE_ANDROID_CLIENT_ID: android });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 1);
  } finally { db.close(); }
});

test("Google OIDC multi-audience and unapproved client recipients never create a trusted subject", async () => {
  const {resolver,token}=await signer();
  const other="12345678901-unapproved.apps.googleusercontent.com";
  // A one-element audience array is still a single intended client.
  assert.equal(await verifyGoogleIdToken(await token({aud:[client]}),client,resolver),sub);
  for(const claims of [
    {aud:[client,other]},
    {aud:[other,client],azp:client},
    {aud:[client,other],azp:other},
    {aud:[client,client],azp:client},
    {aud:[other],azp:client},
    {aud:other,azp:client},
  ]) {
    assert.equal(await verifyGoogleIdToken(await token(claims),client,resolver),
      null,"rejected claims="+JSON.stringify(claims));
  }
});


test("HTTP Google sign-in never persists identity/session for signed but ambiguous audience/azp", async () => {
  const {resolver,token}=await signer();
  const {db,adapter}=openLocalDatabase();
  const allow={async limit(){return {success:true};}};
  const env={
    DB:adapter,GOOGLE_CLIENT_ID:client,
    LOGIN_BURST_LIMITER:allow,ACCOUNT_LOGIN_LIMITER:allow,
  };
  const verified=(jwt,aud)=>verifyGoogleIdToken(jwt,aud,resolver);
  async function login(jwt) {
    return handleRequest(new Request("https://jodlo.rekixo.com/api/v1/auth/google",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({idToken:jwt}),
    }),env,verified);
  }
  try {
    const badTokens=[
      await token({aud:[client,"12345678901-another.apps.googleusercontent.com"]}),
      await token({azp:"12345678901-another.apps.googleusercontent.com"}),
    ];
    for(const jwt of badTokens) {
      const response=await login(jwt);
      assert.equal(response.status,401);
      assert.deepEqual(await response.json(),
        {ok:false,error:{code:"UNAUTHORIZED",message:"Invalid sign-in"}});
    }
    for(const table of ["accounts","google_identities","auth_sessions"]) {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n,0,table);
    }
    const valid=await login(await token({azp:client}));
    assert.equal(valid.status,200);
    const body=await valid.json();
    assert.equal(body.ok,true);
    assert.match(body.data.accessToken,/^[A-Za-z0-9_-]{43}$/);
    for(const table of ["accounts","google_identities","auth_sessions"]) {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n,1,table);
    }
  } finally { db.close(); }
});
