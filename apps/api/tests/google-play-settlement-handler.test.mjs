import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { issueSession, sessionHash } from "../src/modules/identity/sessions.ts";
import { handleConfiguredJodloPlaySettlement as settle } from
  "../src/modules/interactions/google-play-settlement-handler.ts";
import { JODLO_PLAY_SETTLEMENT_POLICY_VERSION as VERSION } from
  "../src/modules/interactions/play-settlement-policy.ts";
import { jodloPlayAccountBinding, jodloPlayPurchaseFingerprint } from
  "../src/modules/interactions/google-play-purchase-preflight.ts";
import { recordTrustedPlayRevocation } from
  "../src/modules/interactions/google-play-rtdn-fences.ts";
import { handleRequest } from "../src/http/router.ts";
import { configuredPlayLicenseTestBindings } from "../src/modules/interactions/play-license-test-policy.ts";

const OWNER = "play-settlement-owner";
const OTHER = "play-settlement-other";
const TOKEN = "synthetic.jodlo.settlement.purchase.00000001";
const SKU = "jodlo.minutes5";
const APPROVAL = "a".repeat(64);
const count = (db, table) => db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
const journal = db => db.prepare("SELECT * FROM play_consume_outbox").get();
const json = value => new Response(JSON.stringify(value), {status: 200});

async function fixture() {
  const {db, adapter} = openLocalDatabase();
  db.exec(`INSERT INTO accounts(id) VALUES ('${OWNER}'),('${OTHER}')`);
  const bearer = (await issueSession(adapter, OWNER)).accessToken;
  const otherBearer = (await issueSession(adapter, OTHER)).accessToken;
  let clock = Date.now();
  const receipt = {
    kind: "androidpublisher#productPurchaseV2",
    obfuscatedExternalAccountId: await jodloPlayAccountBinding(OWNER),
    purchaseStateContext: {purchaseState: "PURCHASED"},
    purchaseCompletionTime: new Date(clock - 100_000).toISOString(),
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    productLineItem: [{productId: SKU, productOfferDetails: {
      quantity: 1, refundableQuantity: 1,
      consumptionState: "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
    }}],
  };
  const f = {
    db, adapter, bearer, otherBearer, receipt,
    requests: [], authCalls: 0, postMode: "success", voids: {voidedPurchases: []},
    hook: async () => {}, authHook: async () => "synthetic-play-oauth-token",
    now: () => clock, advance: ms => { clock += ms; },
    consumed() {
      receipt.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
      receipt.productLineItem[0].productOfferDetails.consumptionState = "CONSUMPTION_STATE_CONSUMED";
    },
    revoke() { db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(f.bearerHash); },
  };
  f.bearerHash = await sessionHash(bearer);
  f.env = {
    DB: adapter, PLAY_SETTLEMENT_ENABLED: "1", PLAY_SETTLEMENT_POLICY_VERSION: VERSION,
    PLAY_SETTLEMENT_APPROVAL_SHA256: APPROVAL,
    PLAY_REFUND_HOLDS_ENABLED: "1", PLAY_REFUND_POLICY_VERSION: "jodlo-play-refund-hold-v1",
    PLAY_REFUND_APPROVAL_SHA256: "c".repeat(64),
    PLAY_CATALOG_ENABLED: "1", PLAY_ACCOUNT_VIEW_ENABLED: "1",
    PLAY_VERIFICATION_ENABLED: "1", PLAY_RTDN_ENABLED: "1",
    PLAY_SETTLEMENT_LIMITER: {limit: async () => ({success: true})},
    PLAY_VERIFICATION_LIMITER: {limit: async () => ({success: true})},
    PLAY_RTDN_LIMITER: {limit: async () => ({success: true})},
    PLAY_RTDN_AUDIENCE: "https://jodlo.example.invalid/api/v1/play/rtdn",
    PLAY_RTDN_PUSH_EMAIL: "push@jodlo-test.iam.gserviceaccount.com",
    PLAY_RTDN_SUBSCRIPTION: "projects/jodlo-test/subscriptions/jodlo-rtdn",
    PLAY_SERVICE_ACCOUNT_EMAIL: "billing@jodlo-test.iam.gserviceaccount.com",
    PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsynthetic-never-used\n-----END PRIVATE KEY-----",
  };
  f.deps = {
    now: f.now,
    accessToken: async () => { f.authCalls++; return f.authHook(f.authCalls); },
    playRequest: async (url, init) => {
      f.requests.push({url, method: init.method});
      await f.hook(url, init);
      if (init.method === "POST") {
        assert.ok(url.endsWith(":consume"));
        assert.equal(init.body, undefined, "consume protocol has an empty request body");
        if (f.postMode === "timeout") return new Promise(() => {});
        if (f.postMode === "throw") throw Error("synthetic lost provider response");
        if (f.postMode === "error") return new Response(null, {status: 503});
        f.consumed();
        return new Response(null, {status: 204});
      }
      assert.equal(init.method, "GET");
      return json(url.includes("/purchases/voidedpurchases") ? f.voids : f.receipt);
    },
  };
  f.request = (opts = {}) => new Request("https://jodlo.example.invalid/api/v1/me/play-settle" + (opts.query ?? ""), {
    method: opts.method ?? "POST",
    headers: {Authorization: "Bearer " + (opts.bearer ?? bearer), "Content-Type": "application/json", ...opts.headers},
    ...(opts.method === "GET" ? {} : {body: opts.body ?? JSON.stringify({purchaseToken: TOKEN, policyVersion: VERSION})}),
  });
  f.call = (opts = {}) => settle(f.request(opts), opts.env ?? f.env, f.deps);
  f.data = async (opts = {}) => {
    const response = await f.call(opts);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    const text = JSON.stringify(body);
    for (const secret of [TOKEN, OWNER, OTHER, f.bearer, "sourceKeyHash", "orderId", "approvalSha256"])
      assert.equal(text.includes(secret), false, "private details must not escape: " + secret);
    return body.data;
  };
  f.posts = () => f.requests.filter(r => r.method === "POST").length;
  return f;
}

/** Intercept a real SQLite statement at its execution boundary to model a
 * concurrent logout/refund. Tests still run actual constraints and triggers. */
function intercept(adapter, matches, before) {
  return {
    ...adapter,
    prepare(sql) {
      const stmt = adapter.prepare(sql);
      const original = stmt.all.bind(stmt);
      stmt.all = async () => {
        if (matches(sql)) await before(sql);
        return original();
      };
      return stmt;
    },
  };
}

test("settlement is absent by default and requires all reviewed release dependencies", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call({env: {DB: f.adapter}})).status, 404);
    assert.equal((await handleRequest(f.request(), {DB: f.adapter})).status, 404);
    for (const key of ["PLAY_SETTLEMENT_POLICY_VERSION", "PLAY_SETTLEMENT_APPROVAL_SHA256",
      "PLAY_SETTLEMENT_LIMITER", "PLAY_ACCOUNT_VIEW_ENABLED", "PLAY_CATALOG_ENABLED",
      "PLAY_VERIFICATION_ENABLED", "PLAY_VERIFICATION_LIMITER", "PLAY_RTDN_ENABLED",
      "PLAY_RTDN_AUDIENCE", "PLAY_RTDN_PUSH_EMAIL", "PLAY_RTDN_SUBSCRIPTION",
      "PLAY_REFUND_HOLDS_ENABLED", "PLAY_REFUND_POLICY_VERSION", "PLAY_REFUND_APPROVAL_SHA256",
      "PLAY_RTDN_LIMITER", "PLAY_SERVICE_ACCOUNT_EMAIL", "PLAY_SERVICE_ACCOUNT_PRIVATE_KEY", "DB"]) {
      const env = {...f.env}; delete env[key];
      assert.equal((await f.call({method: "GET", env})).status, 503, key);
    }
    for (const approval of ["", "0".repeat(64), "a".repeat(63), "UNREVIEWED"])
      assert.equal((await f.call({method: "GET", env: {...f.env, PLAY_SETTLEMENT_APPROVAL_SHA256: approval}})).status, 503);
    assert.equal(f.requests.length, 0);
    assert.equal(count(f.db, "call_credit_events"), 0);
  } finally { f.db.close(); }
});

test("checkout capability uses fresh owner binding and performs no payment or D1 mutation", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.data({method: "GET"}), {
      accountBinding: await jodloPlayAccountBinding(OWNER), policyVersion: VERSION, settlementEnabled: true,
    });
    assert.equal(f.requests.length, 0);
    assert.equal(f.authCalls, 0);
    assert.equal(count(f.db, "play_consume_outbox"), 0);
    assert.equal((await f.call({method: "GET", bearer: "missing"})).status, 401);
    assert.equal((await f.call({method: "GET", query: "?ownerId=foreign"})).status, 400);
    assert.equal((await f.call({method: "PUT"})).status, 405);
    f.env.PLAY_SETTLEMENT_LIMITER = {limit: async () => ({success: false})};
    assert.equal((await f.call()).status, 429);
    f.env.PLAY_SETTLEMENT_LIMITER = {limit: async () => { f.revoke(); return {success: true}; }};
    assert.equal((await f.call({method: "GET"})).status, 401);
    assert.equal(f.requests.length, 0);
  } finally { f.db.close(); }
});

test("settlement request rejects duplicate, extra, escaped, oversized or unapproved inputs", async () => {
  const f = await fixture();
  try {
    const base = {purchaseToken: TOKEN, policyVersion: VERSION};
    const invalid = [
      JSON.stringify({purchaseToken: TOKEN}), JSON.stringify({...base, policyVersion: "future"}),
      JSON.stringify({...base, accountId: OWNER}), JSON.stringify({...base, minutes: 500}),
      JSON.stringify({...base, productId: SKU}), JSON.stringify({...base, price: 1}),
      `{"purchaseToken":"${TOKEN}","purchaseToken":"${TOKEN}","policyVersion":"${VERSION}"}`,
      `{"purchaseToken":"${TOKEN}","policyVersion":"${VERSION}","policyVersion":"${VERSION}"}`,
      `{"purchase\\u0054oken":"${TOKEN}","policyVersion":"${VERSION}"}`,
      JSON.stringify({...base, purchaseToken: "x".repeat(4097)}), "null", "[]", "{broken",
    ];
    for (const body of invalid) assert.equal((await f.call({body})).status, 400, body.slice(0, 80));
    assert.equal((await f.call({headers: {"Content-Type": "text/plain"}})).status, 400);
    assert.equal(f.requests.length, 0);
    assert.equal(count(f.db, "play_consume_outbox"), 0);
    assert.deepEqual(await f.data({body: JSON.stringify({policyVersion: VERSION, purchaseToken: TOKEN})}),
      {status: "settled", productId: SKU, minutes: 5}, "both JSON field orders are accepted");
  } finally { f.db.close(); }
});

test("verified purchase grants once, consumes once and replays its trusted result after consumption", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "play_consume_outbox"), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
    assert.equal(f.db.prepare("SELECT available_seconds FROM call_credit_balances").get().available_seconds, 300);
    const row = journal(f.db);
    assert.equal(row.status, "consumed");
    assert.equal(row.settlement_policy_version, VERSION);
    assert.equal(row.settlement_approval_hash, APPROVAL);
    assert.equal(row.verified_purchased_at_ms, Date.parse(f.receipt.purchaseCompletionTime));
    assert.equal(row.purchase_environment, "production");
    assert.equal(JSON.stringify(row).includes(TOKEN), false);
    const previousRequests = f.requests.length;
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.requests.length, previousRequests, "consumed receipt needs no second grant/provider POST");
    assert.deepEqual(await f.data({bearer: f.otherBearer}), {status: "not_eligible"});
    assert.equal(count(f.db, "call_credit_events"), 1);
    assert.equal(f.posts(), 1);
    assert.throws(() => f.db.prepare("UPDATE play_consume_outbox SET settlement_approval_hash=?").run("b".repeat(64)),
      /PLAY_SETTLEMENT_AUTHORITY_IMMUTABLE/);
    assert.deepEqual(await f.data({env: {...f.env, PLAY_SETTLEMENT_APPROVAL_SHA256: "b".repeat(64)}}),
      {status: "manual_review"}, "a new policy cannot silently adopt an old authorization");
  } finally { f.db.close(); }
});

test("license-test admission is default OFF, server-only and limited to validated account bindings", async () => {
  const f = await fixture();
  try {
    const binding = await jodloPlayAccountBinding(OWNER);
    f.receipt.testPurchaseContext = {fopType: "TEST"};
    for (const env of [f.env,
      {...f.env, PLAY_LICENSE_TEST_ENABLED: "0", PLAY_LICENSE_TEST_ACCOUNT_BINDINGS: binding},
      {...f.env, PLAY_LICENSE_TEST_ENABLED: "1", PLAY_LICENSE_TEST_ACCOUNT_BINDINGS: await jodloPlayAccountBinding(OTHER)},
    ]) assert.deepEqual(await f.data({env}), {status: "not_eligible"});
    assert.equal(count(f.db, "call_credit_events"), 0);
    assert.equal(f.posts(), 0);
    const baseRequests = f.requests.length;
    for (const secret of [undefined, "", "0".repeat(64), "A".repeat(64), "owner@example.invalid",
      binding + "," + binding, " " + binding, binding + ",", Array.from({length: 33}, (_, i) => (i + 1).toString(16).padStart(64, "0")).join(",")]) {
      const env = {...f.env, PLAY_LICENSE_TEST_ENABLED: "1", PLAY_LICENSE_TEST_ACCOUNT_BINDINGS: secret};
      assert.equal(configuredPlayLicenseTestBindings(env), null);
      assert.equal((await f.call({method: "GET", env})).status, 503);
      assert.equal((await f.call({env})).status, 503);
    }
    assert.equal((await f.call({env: {...f.env, PLAY_LICENSE_TEST_ENABLED: "true"}})).status, 503);
    assert.equal(f.requests.length, baseRequests, "invalid enabled policy does not contact Google");
    for (const field of ["licenseTest", "testPurchaseContext", "purchaseEnvironment", "accountBinding"])
      assert.equal((await f.call({body: JSON.stringify({purchaseToken: TOKEN, policyVersion: VERSION,
        [field]: field === "testPurchaseContext" ? {fopType: "TEST"} : "license_test"})})).status, 400);
    assert.equal(count(f.db, "call_credit_events"), 0);
    const maximum = Array.from({length: 32}, (_, i) => (i + 1).toString(16).padStart(64, "0")).join(",");
    assert.equal(configuredPlayLicenseTestBindings({PLAY_LICENSE_TEST_ENABLED: "1",
      PLAY_LICENSE_TEST_ACCOUNT_BINDINGS: maximum}).size, 32);
  } finally { f.db.close(); }
});

test("an allowlisted licensed test receipt grants and consumes once with immutable environment and refund history", async () => {
  const f = await fixture();
  try {
    f.env.PLAY_LICENSE_TEST_ENABLED = "1";
    f.env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS = await jodloPlayAccountBinding(OWNER);
    for (const marker of [null, {}, {fopType: "TEST_PURCHASE"}, {fopType: "TEST", extra: true}]) {
      f.receipt.testPurchaseContext = marker;
      assert.deepEqual(await f.data(), {status: "not_eligible"});
    }
    f.receipt.testPurchaseContext = {fopType: "TEST"};
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(journal(f.db).purchase_environment, "license_test");
    assert.throws(() => f.db.exec("UPDATE play_consume_outbox SET purchase_environment='production'"),
      /PLAY_PURCHASE_ENVIRONMENT_IMMUTABLE/);
    const before = f.requests.length;
    f.env.PLAY_LICENSE_TEST_ENABLED = "0";
    delete f.env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS;
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.requests.length, before, "historical replay grants nothing after QA mode is disabled");
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
    await recordTrustedPlayRevocation(f.adapter, {sourceKeyHash: await jodloPlayPurchaseFingerprint(TOKEN),
      reason: "voided_purchase", recordedAtMs: f.now()});
    assert.deepEqual(await f.data(), {status: "manual_review"});
    const review = f.db.prepare("SELECT o.purchase_environment,r.state FROM play_refund_reviews AS r " +
      "JOIN play_consume_outbox AS o ON o.source_key_hash=r.source_key_hash").get();
    assert.deepEqual({...review}, {purchase_environment: "license_test", state: "open"});
    assert.equal(count(f.db, "call_credit_events"), 1);
  } finally { f.db.close(); }
});

test("ambiguous consume recovery cannot switch the original test or production environment", async () => {
  for (const environment of ["production", "license_test"]) {
    const f = await fixture();
    try {
      f.env.PLAY_LICENSE_TEST_ENABLED = "1";
      f.env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS = await jodloPlayAccountBinding(OWNER);
      if (environment === "license_test") f.receipt.testPurchaseContext = {fopType: "TEST"};
      f.postMode = "throw";
      assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
      f.consumed();
      if (environment === "production") f.receipt.testPurchaseContext = {fopType: "TEST"};
      else delete f.receipt.testPurchaseContext;
      assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
      assert.equal(journal(f.db).status, "unknown");
      assert.equal(journal(f.db).purchase_environment, environment);
      if (environment === "production") delete f.receipt.testPurchaseContext;
      else f.receipt.testPurchaseContext = {fopType: "TEST"};
      f.env.PLAY_LICENSE_TEST_ENABLED = "0";
      delete f.env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS;
      assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
      assert.equal(f.posts(), 1, "recovery remains GET-only after the uncertain consume");
      assert.equal(count(f.db, "call_credit_events"), 1);
    } finally { f.db.close(); }
  }
});

test("a definitely-unsent journal cannot be reinterpreted under another receipt environment", async () => {
  for (const environment of ["production", "license_test"]) {
    const f = await fixture();
    try {
      f.env.PLAY_LICENSE_TEST_ENABLED = "1";
      f.env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS = await jodloPlayAccountBinding(OWNER);
      if (environment === "license_test") f.receipt.testPurchaseContext = {fopType: "TEST"};
      f.authHook = async n => n === 3 ? null : "synthetic-oauth";
      assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
      assert.equal(journal(f.db).status, "ready");
      f.authHook = async () => "synthetic-oauth";
      if (environment === "production") f.receipt.testPurchaseContext = {fopType: "TEST"};
      else delete f.receipt.testPurchaseContext;
      assert.deepEqual(await f.data(), {status: "manual_review"});
      assert.equal(f.posts(), 0);
      assert.equal(journal(f.db).purchase_environment, environment);
      assert.equal(count(f.db, "call_credit_events"), 1);
    } finally { f.db.close(); }
  }
});

test("simultaneous settlements race through one SQLite grant and one consume lease", async () => {
  const f = await fixture();
  try {
    const values = await Promise.all([f.data(), f.data(), f.data()]);
    assert.ok(values.every(v => ["settled", "pending_reconciliation"].includes(v.status)));
    assert.equal(count(f.db, "call_credit_events"), 1);
    assert.equal(count(f.db, "play_consume_outbox"), 1);
    assert.equal(f.posts(), 1);
    assert.equal(journal(f.db).status, "consumed");
  } finally { f.db.close(); }
});

test("pending, foreign, canceled, partial, test, unapproved and already consumed receipts cannot create credits", async () => {
  const changes = [
    r => { r.purchaseStateContext.purchaseState = "PENDING"; },
    r => { r.purchaseStateContext.purchaseState = "CANCELLED"; },
    r => { r.obfuscatedExternalAccountId = "b".repeat(64); },
    r => { r.testPurchaseContext = {fopType: "TEST"}; },
    r => { r.productLineItem[0].productId = "unapproved.product"; },
    r => { r.productLineItem[0].productOfferDetails.refundableQuantity = 0; },
    r => { r.productLineItem[0].productOfferDetails.quantity = 2; },
    r => { r.productLineItem[0].productOfferDetails.consumptionState = "CONSUMPTION_STATE_CONSUMED"; },
  ];
  for (const change of changes) {
    const f = await fixture();
    try {
      change(f.receipt);
      assert.deepEqual(await f.data(), {status: "not_eligible"});
      assert.equal(count(f.db, "call_credit_events"), 0);
      assert.equal(f.posts(), 0);
    } finally { f.db.close(); }
  }
});

test("voided purchase and incomplete or old refund history fail without granting", async () => {
  const f = await fixture();
  try {
    f.voids = {voidedPurchases: [{kind: "androidpublisher#voidedPurchase", purchaseToken: TOKEN}]};
    assert.deepEqual(await f.data(), {status: "not_eligible"});
    f.voids = {voidedPurchases: [], tokenPagination: {nextPageToken: "repeated-cursor"}};
    assert.equal((await f.call()).status, 503);
    f.voids = {voidedPurchases: []};
    f.receipt.purchaseCompletionTime = new Date(f.now() - 30 * 86400_000).toISOString();
    assert.equal((await f.call()).status, 503);
    assert.equal(count(f.db, "call_credit_events"), 0);
    assert.equal(f.posts(), 0);
  } finally { f.db.close(); }
});

test("revocation arriving exactly before grant atomically defeats stale Google evidence", async () => {
  const f = await fixture();
  try {
    let inserted = false;
    f.env.DB = intercept(f.adapter, sql => sql.startsWith("INSERT INTO play_consume_outbox"), async () => {
      if (inserted) return; inserted = true;
      await recordTrustedPlayRevocation(f.adapter, {
        sourceKeyHash: await jodloPlayPurchaseFingerprint(TOKEN),
        reason: "voided_purchase", recordedAtMs: f.now(),
      });
    });
    assert.deepEqual(await f.data(), {status: "manual_review"});
    assert.equal(count(f.db, "call_credit_events"), 0);
    assert.equal(count(f.db, "play_consume_outbox"), 0);
    assert.equal(f.posts(), 0);
  } finally { f.db.close(); }
});

test("ambiguous consume has one credit, never resends, and explicit GET recovery confirms same purchase", async () => {
  const f = await fixture();
  try {
    f.postMode = "throw";
    assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
    assert.equal(journal(f.db).status, "unknown");
    assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
    assert.equal(f.posts(), 1, "an unconsumed unknown state is never automatically retried");
    f.consumed();
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
    assert.equal(journal(f.db).status, "consumed");
  } finally { f.db.close(); }
});

test("outbox response loss after actual consume recovers by GET after lease expiry without a second credit", async () => {
  const f = await fixture();
  try {
    f.env.DB = intercept(f.adapter, sql => sql.startsWith("UPDATE play_consume_outbox SET status=?"),
      () => { throw Error("synthetic D1 result loss"); });
    assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
    assert.equal(journal(f.db).status, "sending");
    assert.equal(f.posts(), 1);
    f.env.DB = f.adapter;
    f.advance(16_000);
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
  } finally { f.db.close(); }
});

test("certain unsent OAuth failure releases its lease and explicit restore safely completes it once", async () => {
  const f = await fixture();
  try {
    f.authHook = async n => n === 3 ? null : "synthetic-oauth";
    assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
    assert.equal(journal(f.db).status, "ready");
    assert.equal(f.posts(), 0);
    f.authHook = async () => "synthetic-oauth";
    assert.deepEqual(await f.data(), {status: "settled", productId: SKU, minutes: 5});
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
  } finally { f.db.close(); }
});

test("logout during provider verification, at SQL insertion, or before consume is respected", async () => {
  for (const race of ["verification", "insert", "consume"]) {
    const f = await fixture();
    try {
      if (race === "verification") f.hook = async url => {
        if (url.includes("voidedpurchases")) f.revoke();
      };
      if (race === "insert") f.env.DB = intercept(f.adapter,
        sql => sql.startsWith("INSERT INTO play_consume_outbox"), () => f.revoke());
      if (race === "consume") f.authHook = async n => {
        if (n === 3) f.revoke();
        return "synthetic-oauth";
      };
      assert.equal((await f.call()).status, 401, race);
      assert.equal(f.posts(), 0, race);
      assert.equal(count(f.db, "call_credit_events"), race === "consume" ? 1 : 0, race);
      if (race === "consume") assert.equal(journal(f.db).status, "ready");
    } finally { f.db.close(); }
  }
});

test("same-session changed-owner, disable and expiry races cannot stage a grant", async () => {
  for (const state of ["owner", "disabled", "expired"]) {
    const f = await fixture();
    try {
      f.env.DB = intercept(f.adapter, sql => sql.startsWith("INSERT INTO play_consume_outbox"), () => {
        if (state === "owner") f.db.prepare("UPDATE auth_sessions SET account_id=? WHERE token_hash=?").run(OTHER, f.bearerHash);
        if (state === "disabled") f.db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(OWNER);
        if (state === "expired") f.db.prepare("UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?").run(f.bearerHash);
      });
      assert.equal((await f.call()).status, 401, state);
      assert.equal(count(f.db, "call_credit_events"), 0);
      assert.equal(f.posts(), 0);
    } finally { f.db.close(); }
  }
});

test("logout during ambiguous-consume recovery cannot commit a stale private result", async () => {
  const f = await fixture();
  try {
    f.postMode = "throw";
    await f.data();
    f.consumed();
    f.hook = async url => { if (url.includes("productsv2")) f.revoke(); };
    assert.equal((await f.call()).status, 401);
    assert.equal(journal(f.db).status, "unknown");
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
  } finally { f.db.close(); }
});

test("refund racing provider success wins; it cannot be reported as settled or re-granted", async () => {
  const f = await fixture();
  try {
    f.hook = async (_url, init) => {
      if (init.method === "POST") await recordTrustedPlayRevocation(f.adapter, {
        sourceKeyHash: await jodloPlayPurchaseFingerprint(TOKEN),
        reason: "voided_purchase", recordedAtMs: f.now(),
      });
    };
    assert.deepEqual(await f.data(), {status: "manual_review"});
    assert.deepEqual(await f.data(), {status: "manual_review"});
    assert.equal((await f.call({method: "GET"})).status, 409, "cannot advertise checkout into a refund hold");
    assert.equal(journal(f.db).status, "void_hold");
    assert.equal(f.posts(), 1);
    assert.equal(count(f.db, "call_credit_events"), 1);
  } finally { f.db.close(); }
});

test("late provider callbacks cannot issue another POST after bounded timeout", async () => {
  const f = await fixture();
  try {
    let finish;
    f.deps.timeoutMs = 40;
    f.authHook = async n => n === 3 ? new Promise(resolve => { finish = resolve; }) : "synthetic-oauth";
    assert.deepEqual(await f.data(), {status: "pending_reconciliation"});
    assert.equal(journal(f.db).status, "ready");
    finish("synthetic-late-oauth");
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.posts(), 0);
    assert.equal(journal(f.db).status, "ready");
  } finally { f.db.close(); }
});
