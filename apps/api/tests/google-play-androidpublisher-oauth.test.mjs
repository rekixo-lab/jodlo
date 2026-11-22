import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { createPlayAndroidPublisherAccessTokenSource } from
  "../src/modules/interactions/google-play-androidpublisher-oauth.ts";

const {privateKey} = generateKeyPairSync("rsa",{modulusLength:2048});
const fakeAccount = {
  email:"play-ci@jodlo-project.iam.gserviceaccount.com",
  privateKey:privateKey.export({format:"pem",type:"pkcs8"}),
};
const goodToken = {
  access_token:"synthetic-androidpublisher-bearer-123",
  token_type:"Bearer",
  expires_in:3600,
};

test("Play OAuth signs scoped assertion, single-flights refresh and caches safe token",async()=>{
  let requests=0;
  const access=createPlayAndroidPublisherAccessTokenSource(fakeAccount,async(url,init)=>{
    requests++;
    assert.equal(url,"https://oauth2.googleapis.com/token");
    assert.equal(init.method,"POST");
    assert.equal(init.redirect,"error");
    assert.equal(init.headers["Content-Type"],"application/x-www-form-urlencoded");
    assert.equal(init.body.get("grant_type"),
      "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion=init.body.get("assertion");
    assert.equal(typeof assertion,"string");
    const [header,claims,signature]=assertion.split(".");
    assert.ok(signature && signature.length>100);
    assert.equal(JSON.parse(Buffer.from(header,"base64url")).alg,"RS256");
    const payload=JSON.parse(Buffer.from(claims,"base64url"));
    assert.equal(payload.iss,fakeAccount.email);
    assert.equal(payload.aud,"https://oauth2.googleapis.com/token");
    assert.equal(payload.scope,"https://www.googleapis.com/auth/androidpublisher");
    assert.equal(payload.exp-payload.iat,300);
    return new Response(JSON.stringify(goodToken),{status:200});
  });
  const values=await Promise.all(Array.from({length:5},()=>access()));
  assert.deepEqual(values,Array(5).fill(goodToken.access_token));
  assert.equal(await access(),goodToken.access_token);
  assert.equal(requests,1,"parallel calls and cached reads must reuse the same token");
});

test("Play OAuth rejects invalid configuration before attempting network access",()=>{
  assert.throws(()=>createPlayAndroidPublisherAccessTokenSource(fakeAccount,
    async()=>new Response("{}",{status:200}),3001),/Invalid Play OAuth configuration/);
  assert.throws(()=>createPlayAndroidPublisherAccessTokenSource({
    ...fakeAccount,email:"not-an-approved-service-account@example.com",
  }),/Invalid Play OAuth service account/);
  assert.throws(()=>createPlayAndroidPublisherAccessTokenSource({
    ...fakeAccount,privateKey:"-----BEGIN PRIVATE KEY-----garbage",
  },async()=>new Response("{}",{status:200}),0),/Invalid Play OAuth configuration/);
});

test("Play OAuth fails closed for oversized, malformed and untrusted provider responses",async()=>{
  const cases=[
    ["HTTP failure",()=>new Response("forbidden",{status:403})],
    ["oversized declared length",()=>new Response("{}",{headers:{"Content-Length":"4097"}})],
    ["oversized streamed body",()=>new Response("x".repeat(4097))],
    ["invalid content length",()=>new Response("{}",{headers:{"Content-Length":"invalid"}})],
    ["invalid JSON",()=>new Response("{broken")],
    ["invalid UTF-8",()=>new Response(Uint8Array.from([0xc3,0x28]))],
    ["missing body",()=>new Response(null)],
    ["wrong token type",()=>new Response(JSON.stringify({...goodToken,token_type:"MAC"}))],
    ["too-short lifetime",()=>new Response(JSON.stringify({...goodToken,expires_in:89}))],
    ["missing access token",()=>new Response(JSON.stringify({...goodToken,access_token:undefined}))],
  ];
  for(const [name,response] of cases){
    let sends=0;
    const access=createPlayAndroidPublisherAccessTokenSource(fakeAccount,async()=>{
      sends++;
      return response();
    });
    assert.equal(await access(),null,name);
    assert.equal(sends,1,name+" makes only one request");
  }
});

test("Play OAuth rejects a stalled response stream within its global deadline",async()=>{
  let requests=0;
  const access=createPlayAndroidPublisherAccessTokenSource(fakeAccount,async()=>{
    requests++;
    return new Response(new ReadableStream({start(){}}));
  },150);
  const started=performance.now();
  assert.equal(await access(),null);
  assert.ok(performance.now()-started<1500,"stalled stream must not hang the token refresh");
  assert.equal(requests,1);
});
