import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionConfig, verifyProductionConfig } from "./prepare-production-wrangler.mjs";

const base = Object.freeze({
  name: "jodlo-api", main: "src/index.ts",
  compatibility_date: "2026-10-27", workers_dev: false, send_metrics: false,
});
const env = Object.freeze({
  JODLO_CF_ACCOUNT_ID: "a13579bdf02468ace2468bdf13579abc",
  JODLO_D1_DATABASE_ID: "31a5b79d-2468-4123-9def-c16aef248062",
  JODLO_LOGIN_BURST_NAMESPACE_ID: "45130001",
  JODLO_ACCOUNT_LOGIN_NAMESPACE_ID: "45130002",
});
const valid = () => buildProductionConfig(env, base);

test("real owner-supplied Cloudflare IDs produce exactly one private JODLO DB and both login guards", () => {
  const config = valid();
  assert.deepEqual(verifyProductionConfig(config), {
    accountId: env.JODLO_CF_ACCOUNT_ID, databaseId: env.JODLO_D1_DATABASE_ID,
  });
  assert.equal(config.workers_dev, false);
  assert.equal(config.name, "jodlo-api");
  assert.deepEqual(Object.keys(config), [
    "name","main","compatibility_date","workers_dev","send_metrics",
    "account_id","d1_databases","ratelimits",
  ]);
  assert.deepEqual(config.d1_databases,[{
    binding:"DB",database_name:"jodlo-production",
    database_id:env.JODLO_D1_DATABASE_ID,
    migrations_dir:"../../infra/migrations",
  }]);
  assert.deepEqual(config.ratelimits.map(x=>x.name),
    ["LOGIN_BURST_LIMITER","ACCOUNT_LOGIN_LIMITER"]);
  assert.equal(JSON.stringify(config).includes("oauth"),false);
  assert.equal(JSON.stringify(config).includes("token"),false);
  assert.equal(JSON.stringify(config).includes("password"),false);
  assert.equal(JSON.stringify(config).includes("route"),false);
});

test("no account ID or D1 UUID, malformed identifiers, local D1 fixture and fake namespaces are refused",()=>{
  for(const bad of [
    {JODLO_CF_ACCOUNT_ID:""},
    {JODLO_CF_ACCOUNT_ID:"placeholder"},
    {JODLO_CF_ACCOUNT_ID:"0".repeat(32)},
    {JODLO_D1_DATABASE_ID:""},
    {JODLO_D1_DATABASE_ID:"00000000-0000-0000-0000-000000000001"},
    {JODLO_D1_DATABASE_ID:"00000000-0000-0000-0000-000000000000"},
    {JODLO_D1_DATABASE_ID:"example-database"},
    {JODLO_LOGIN_BURST_NAMESPACE_ID:"1001"},
    {JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:"1002"},
    {JODLO_LOGIN_BURST_NAMESPACE_ID:"0"},
    {JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:"-3"},
    {JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:"1; rm -rf"},
    {JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:"999999999999"},
    {JODLO_ACCOUNT_LOGIN_NAMESPACE_ID:env.JODLO_LOGIN_BURST_NAMESPACE_ID},
    {JODLO_FINWORKAR_CF_ACCOUNT_ID:env.JODLO_CF_ACCOUNT_ID},
  ]) {
    assert.throws(()=>buildProductionConfig({...env,...bad},base),
      undefined,JSON.stringify(bad));
  }
  for(const missing of Object.keys(env)) {
    const copy={...env};delete copy[missing];
    assert.throws(()=>buildProductionConfig(copy,base),undefined,missing);
  }
});

test("a changed Wrangler baseline or live route cannot silently inherit unsafe values",()=>{
  for(const mutation of [
    {workers_dev:true},
    {name:"finworkar-api"},
    {main:"../private.ts"},
    {routes:["*/*"]},
    {vars:{GOOGLE_CLIENT_ID:"unreviewed"}},
    {d1_databases:[{binding:"DB"}]},
    {ratelimits:[]},
    {account_id:env.JODLO_CF_ACCOUNT_ID},
    {secrets:{GOOGLE_CLIENT_ID:"leaked"}},
  ]) assert.throws(()=>buildProductionConfig(env,{...base,...mutation}),
    undefined,JSON.stringify(mutation));
});

test("validator rejects production route, unsafe binding, deleted limit and extra provider fields",()=>{
  const mutations=[
    x=>{x.workers_dev=true;},
    x=>{x.routes=["*/*"];},
    x=>{x.vars={TOKEN:"secret"};},
    x=>{x.name="finworkar-api";},
    x=>{x.d1_databases[0].database_id="00000000-0000-0000-0000-000000000001";},
    x=>{x.d1_databases[0].database_name="legacy";},
    x=>{x.d1_databases[0].migrations_dir="../unsafe";},
    x=>{x.d1_databases.push({binding:"R2"});},
    x=>{x.ratelimits.pop();},
    x=>{x.ratelimits[0].simple.limit=0;},
    x=>{x.ratelimits[0].namespace_id="1001";},
    x=>{x.ratelimits[1].namespace_id=x.ratelimits[0].namespace_id;},
    x=>{x.ratelimits[0].name="WRONG";},
    x=>{x.account_id="0".repeat(32);},
  ];
  for(const mutate of mutations) {
    const config=structuredClone(valid());
    mutate(config);
    assert.throws(()=>verifyProductionConfig(config));
  }
});

test("production config is JSON serializable with no secret values and no route",()=>{
  const config=valid();
  assert.deepEqual(verifyProductionConfig(JSON.parse(JSON.stringify(config))),
    {accountId:env.JODLO_CF_ACCOUNT_ID,databaseId:env.JODLO_D1_DATABASE_ID});
});
