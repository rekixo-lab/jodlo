import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionConfig } from "./prepare-production-wrangler.mjs";
import {
  API_HOSTNAME, API_ORIGIN, buildDomainConfig, verifyDomainConfig
} from "./prepare-api-custom-domain.mjs";

const privateBaseline = Object.freeze({
  name: "jodlo-api", main: "src/index.ts",
  compatibility_date: "2026-10-27", workers_dev: false, send_metrics: false
});
const env = Object.freeze({
  JODLO_CF_ACCOUNT_ID: "a13579bdf02468ace2468bdf13579abc",
  JODLO_D1_DATABASE_ID: "31a5b79d-2468-4123-9def-c16aef248062",
  JODLO_LOGIN_BURST_NAMESPACE_ID: "45130001",
  JODLO_ACCOUNT_LOGIN_NAMESPACE_ID: "45130002",
});
const privateConfig = () => buildProductionConfig(env, privateBaseline);

test("founder-confirmed API hostname and public endpoint are distinct from website",()=>{
  assert.equal(API_HOSTNAME, "api.jodlo.rekixo.com");
  assert.equal(API_ORIGIN + "/api/v1/health",
    "https://api.jodlo.rekixo.com/api/v1/health");
  assert.notEqual(API_HOSTNAME, "jodlo.rekixo.com");
});

test("explicit domain config maps exact hostname with Cloudflare custom_domain, preserving bindings",()=>{
  const source = privateConfig();
  const before = structuredClone(source);
  const domain = buildDomainConfig(source);
  assert.deepEqual(domain.routes,
    [{ pattern:"api.jodlo.rekixo.com", custom_domain:true }]);
  assert.equal(domain.name,"jodlo-api");
  assert.equal(domain.workers_dev,false);
  assert.equal(domain.preview_urls,false);
  assert.deepEqual(domain.d1_databases,before.d1_databases);
  assert.deepEqual(domain.ratelimits,before.ratelimits);
  assert.equal(domain.account_id,before.account_id);
  assert.equal(domain.route,undefined);
  assert.deepEqual(verifyDomainConfig(domain),{
    accountId:env.JODLO_CF_ACCOUNT_ID,databaseId:env.JODLO_D1_DATABASE_ID
  });
  assert.deepEqual(source,before,"building public route cannot mutate no-route owner config");
});

test("only separate exact Custom Domain allowed, never wildcard, path route or website",()=>{
  const badRoutes=[
    [],
    [{ pattern:"jodlo.rekixo.com",custom_domain:true }],
    [{ pattern:"api.jodlo.rekixo.com/*",custom_domain:true }],
    [{ pattern:"api.jodlo.rekixo.com",custom_domain:false }],
    [{ pattern:"*.rekixo.com",custom_domain:true }],
    [{ pattern:"rekixo.com",custom_domain:true }],
    [{ pattern:"api.jodlo.rekixo.com",custom_domain:true,zone_name:"rekixo.com" }],
    [{ pattern:"api.jodlo.rekixo.com",custom_domain:true },
      { pattern:"jodlo.rekixo.com",custom_domain:true }],
    [{ pattern:"API.JODLO.REKIXO.COM",custom_domain:true }],
    null,
    "api.jodlo.rekixo.com",
  ];
  for(const routes of badRoutes){
    const config=buildDomainConfig(privateConfig());
    config.routes=routes;
    assert.throws(()=>verifyDomainConfig(config),undefined,JSON.stringify(routes));
  }
});

test("missing preview safety, wrong DB/account or route override rejects release",()=>{
  const mutations=[
    c=>{c.workers_dev=true;},
    c=>{c.preview_urls=true;},
    c=>{delete c.preview_urls;},
    c=>{c.account_id="0".repeat(32);},
    c=>{c.d1_databases[0].database_name="rekixo-site-production";},
    c=>{c.ratelimits.pop();},
    c=>{c.route="api.jodlo.rekixo.com/*";},
    c=>{c.zone_id="other-zone";},
    c=>{c.vars={TOKEN:"unsafe"};},
    c=>{c.services=[{binding:"OTHER",service:"not-jodlo"}];},
  ];
  for(const mutate of mutations){
    const config=buildDomainConfig(privateConfig());
    mutate(config);
    assert.throws(()=>verifyDomainConfig(config));
  }
});

test("cannot derive a public custom domain from stale or unsafe private production config",()=>{
  const source=privateConfig();
  for(const mutation of [
    x=>{delete x.preview_urls;},
    x=>{x.preview_urls=true;},
    x=>{x.routes=[{pattern:"rekixo.com",custom_domain:true}];},
    x=>{x.workers_dev=true;},
    x=>{x.d1_databases[0].database_id="00000000-0000-0000-0000-000000000001";},
    x=>{x.account_id="0".repeat(32);},
  ]){
    const input=structuredClone(source);
    mutation(input);
    assert.throws(()=>buildDomainConfig(input));
  }
});
