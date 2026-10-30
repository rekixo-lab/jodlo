import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { validGoogleClientId, verifyGoogleIdToken } from "../src/modules/identity/google.ts";

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
