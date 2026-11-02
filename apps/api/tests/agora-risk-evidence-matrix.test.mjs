import assert from "node:assert/strict";
import test from "node:test";
import { openLocalDatabase } from "./helpers/local-db.mjs";
import { ensureAccount } from "../src/modules/identity/accounts.ts";
import { issueSession } from "../src/modules/identity/sessions.ts";
import { optInAsWorker } from "../src/modules/workers/profile.ts";
import { publishListing } from "../src/modules/workers/listings.ts";
import { setOwnWorkerAgoraCallPreference } from
  "../src/modules/workers/agora-call-preference.ts";
import { composeSyntheticAgoraInviteRisk } from
  "../src/modules/interactions/agora-risk-evidence.ts";
import { prepareSyntheticSafetyCheckedAgoraInvite } from
  "../src/modules/interactions/agora-invite-safety.ts";

/**
 * All checks here are SCRIPTED test facts; not live presence, actual busy slots,
 * a block/report database, reserved quota or signed provider attestations.
 * All fixture clock values are test inputs, NOT T01/T02 product deadlines.
 */
const CALLER = "account-risk-matrix-caller";
const WORKER = "account-risk-matrix-worker";
const LISTING = "listing-risk-matrix-00001";
const NOW = 1_800_000_000_000;
const DEADLINE = NOW + 20_000;
const identity = Object.freeze({
  callerAccountId: CALLER, workerAccountId: WORKER, listingId: LISTING,
});
const allowed = Object.freeze({
  workerPresence: "online", workerAvailability: "available",
  blockedByCaller: false, blockedByWorker: false,
  rateGate: "pass", recipientVerified: true, privacyApproved: true,
});
const KINDS = [
  "synthetic_presence_check_v1",
  "synthetic_availability_check_v1",
  "synthetic_mutual_blocks_check_v1",
  "synthetic_rate_check_v1",
  "synthetic_connection_check_v1",
];

function checksFor(state = allowed) {
  const base = { ...identity, checkedAtMs: NOW - 10, expiresAtMs: DEADLINE };
  return [
    { ...base, kind: KINDS[0], workerPresence: state.workerPresence },
    { ...base, kind: KINDS[1], workerAvailability: state.workerAvailability },
    { ...base, kind: KINDS[2], blockedByCaller: state.blockedByCaller,
      blockedByWorker: state.blockedByWorker },
    { ...base, kind: KINDS[3], rateGate: state.rateGate },
    { ...base, kind: KINDS[4], recipientVerified: state.recipientVerified,
      privacyApproved: state.privacyApproved },
  ];
}

function permutations(xs) {
  if (xs.length === 0) return [[]];
  return xs.flatMap((x, i) => permutations([
    ...xs.slice(0, i), ...xs.slice(i + 1),
  ]).map(others => [x, ...others]));
}

test("120 orders of five independently scoped test checks yield one identical bounded result", () => {
  const pieces = checksFor();
  const adjusted = pieces.map((check, i) => ({
    ...check,
    checkedAtMs: NOW - (i + 1) * 10,
    expiresAtMs: DEADLINE - i * 100,
  }));
  const original = structuredClone(adjusted);
  const baseline = composeSyntheticAgoraInviteRisk(identity, NOW, adjusted);
  assert.ok(baseline);
  assert.equal(baseline.checkedAtMs, NOW - 10);
  assert.equal(baseline.expiresAtMs, DEADLINE - 400);
  assert.equal(Object.isFrozen(baseline), true);
  let total = 0;
  for (const ordered of permutations(adjusted)) {
    total++;
    const result = composeSyntheticAgoraInviteRisk(identity, NOW, ordered);
    assert.deepEqual(result, baseline, "input order must not affect consent facts");
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(total, 120);
  assert.deepEqual(adjusted, original, "composition must not mutate its inputs");
  for (const secretField of ["token", "phone", "channel", "rtcUid", "provider"])
    assert.equal(JSON.stringify(baseline).includes(secretField), false);
});

test("synthetic evidence expiry is exclusive and no single older check can extend it", () => {
  const originals = checksFor();
  const early = originals.map((item, i) =>
    i === 3 ? { ...item, expiresAtMs: NOW + 1 } : item);
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW, early).expiresAtMs,
    NOW + 1);
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW + 1, early), null,
    "at the earliest fake expiry the complete composition is invalid");
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW - 11, originals), null,
    "even one future-checked fact must fail closed");
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW, originals.slice(1)),
    null, "absence of any dimension cannot be mistaken for approval");
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW,
    [originals[0], originals[0], ...originals.slice(2)]),
    null, "duplicate presence cannot stand in for missing availability");
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW,
    originals.map((item, i) => i === 2 ? {
      ...item, callerAccountId: "account-another-caller0001",
    } : item)), null, "one cross-identity fact poisons the bundle");
  assert.equal(composeSyntheticAgoraInviteRisk(identity, NOW,
    originals.map((item, i) => i === 4 ? {
      ...item, extraDeviceToken: "not-approved",
    } : item)), null, "unexpected fields are refused rather than forwarded");
});

async function localFixture() {
  const { db, adapter } = openLocalDatabase();
  try {
    await ensureAccount(adapter, CALLER);
    await ensureAccount(adapter, WORKER);
    await optInAsWorker(adapter, WORKER);
    db.prepare(
      "INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)",
    ).run("risk-matrix-category", "risk-matrix-category", "Test category",
      "परीक्षण वर्ग");
    const listing = await publishListing(adapter, WORKER, "risk-matrix-category");
    assert.ok(listing);
    const callerToken = (await issueSession(adapter, CALLER))?.accessToken;
    const workerToken = (await issueSession(adapter, WORKER))?.accessToken;
    assert.ok(callerToken && workerToken);
    return {
      db, adapter, listing, callerToken, workerToken,
      close() { db.close(); },
    };
  } catch (err) {
    db.close();
    throw err;
  }
}

test("576 risk state combinations permit a synthetic invite ONLY if every fact passes", async () => {
  const fixture = await localFixture();
  try {
    const bound = { ...identity, listingId: fixture.listing.id };
    const checkBundle = values => checksFor(values).map(item => ({
      ...item, listingId: fixture.listing.id,
    }));
    const prepare = async values => {
      const risk = composeSyntheticAgoraInviteRisk(bound, NOW, checkBundle(values));
      assert.ok(risk, "all enumerated values are legal but not necessarily safe");
      return prepareSyntheticSafetyCheckedAgoraInvite(
        fixture.adapter, fixture.callerToken, fixture.listing.id,
        "call-risk-matrix-00001", NOW, DEADLINE, risk,
      );
    };
    const beforeConsent = await prepare(allowed);
    assert.deepEqual(beforeConsent, { kind: "denied" },
      "real D1 worker call opt-in remains OFF by default");
    const enabled = await setOwnWorkerAgoraCallPreference(
      fixture.adapter, fixture.workerToken, true, 0);
    assert.equal(enabled.kind, "updated");

    let total = 0;
    let prepared = 0;
    for (const workerPresence of ["online", "offline", "unknown"])
    for (const workerAvailability of ["available", "busy", "unavailable", "unknown"])
    for (const blockedByCaller of [false, true])
    for (const blockedByWorker of [false, true])
    for (const rateGate of ["pass", "deny", "unknown"])
    for (const recipientVerified of [true, false])
    for (const privacyApproved of [true, false]) {
      const state = {
        workerPresence, workerAvailability, blockedByCaller, blockedByWorker,
        rateGate, recipientVerified, privacyApproved,
      };
      const allPass =
        workerPresence === "online" &&
        workerAvailability === "available" &&
        !blockedByCaller && !blockedByWorker &&
        rateGate === "pass" && recipientVerified && privacyApproved;
      const verdict = await prepare(state);
      total++;
      if (allPass) {
        prepared++;
        assert.equal(verdict.kind, "prepared", JSON.stringify(state));
        assert.equal(verdict.call.callerAccountId, CALLER);
        assert.equal(verdict.call.workerAccountId, WORKER);
        assert.equal(verdict.call.listingId, fixture.listing.id);
        assert.equal(Object.isFrozen(verdict.call), true);
      } else {
        assert.deepEqual(verdict, { kind: "denied" }, JSON.stringify(state));
      }
      const raw = JSON.stringify(verdict);
      assert.equal(raw.includes(fixture.callerToken), false);
      assert.equal(raw.includes(fixture.workerToken), false);
      assert.equal(raw.includes("agoraChannel"), false);
      assert.equal(raw.includes("phoneNumber"), false);
    }
    assert.equal(total, 576);
    assert.equal(prepared, 1,
      "exactly one hypothetical all-pass state is a candidate, not a real call");
    const off = await setOwnWorkerAgoraCallPreference(
      fixture.adapter, fixture.workerToken, false, 1);
    assert.equal(off.kind, "updated");
    assert.deepEqual(await prepare(allowed), { kind: "denied" },
      "fresh scripted evidence cannot override opt-out");
  } finally {
    fixture.close();
  }
});

test("a composed hypothetical pass stays bound to the exact listing", async () => {
  const fixture = await localFixture();
  try {
    const wrong = composeSyntheticAgoraInviteRisk(
      identity, NOW, checksFor());
    assert.ok(wrong);
    assert.deepEqual(await prepareSyntheticSafetyCheckedAgoraInvite(
      fixture.adapter, fixture.callerToken, fixture.listing.id,
      "call-risk-matrix-00002", NOW, DEADLINE, wrong,
    ), { kind: "denied" }, "no cross-listing replay of otherwise passing facts");
  } finally {
    fixture.close();
  }
});

test("hidden, symbol and accessor evidence is rejected in every scripted safety dimension",()=>{
  const base=checksFor();
  const valid=composeSyntheticAgoraInviteRisk(identity,NOW,base);
  assert.ok(valid);
  for(let i=0;i<base.length;i++){
    const hidden={...base[i]};
    Object.defineProperty(hidden,"hiddenAuthBearer",{
      value:"secret",enumerable:false,
    });
    const extraSymbol={...base[i]};
    extraSymbol[Symbol("privateDevice")]="secret";
    const accessed={...base[i]};
    const field=[
      "workerPresence","workerAvailability","blockedByWorker",
      "rateGate","privacyApproved",
    ][i];
    let getterReads=0;
    Object.defineProperty(accessed,field,{
      enumerable:true,configurable:true,
      get(){getterReads++;return base[i][field];},
    });
    const untrusted=[
      hidden,extraSymbol,accessed,
      new Proxy({...base[i]},{
        ownKeys(){throw Error("untrusted adapter");},
      }),
    ];
    for(const one of untrusted){
      const checks=base.map((part,j)=>j===i?one:part);
      assert.equal(composeSyntheticAgoraInviteRisk(identity,NOW,checks),null,
        "unexpected own field/getter/proxy must not certify risk dimension "+i);
    }
    assert.equal(getterReads,0,
      "risk composer must inspect descriptors without invoking getters");
  }
  const identityWithHidden={...identity};
  Object.defineProperty(identityWithHidden,"rawAuthToken",{
    value:"secret",enumerable:false,
  });
  const identityWithSymbol={...identity};
  identityWithSymbol[Symbol("providerIdentity")]="secret";
  const identityWithGetter={...identity};
  let identityGetReads=0;
  Object.defineProperty(identityWithGetter,"callerAccountId",{
    enumerable:true,get(){identityGetReads++;return CALLER;},
  });
  for(const untrusted of [
    identityWithHidden,identityWithSymbol,identityWithGetter,
    new Proxy({...identity},{ownKeys(){throw Error("bad identity");}}),
  ]){
    assert.equal(composeSyntheticAgoraInviteRisk(untrusted,NOW,base),null);
  }
  assert.equal(identityGetReads,0);
  assert.deepEqual(composeSyntheticAgoraInviteRisk(identity,NOW,base),valid,
    "rejecting suspicious fixtures must not reject ordinary strict data");
});

test("composed safety verdict cannot drift when original presence, block or rate inputs mutate",()=>{
  const base=checksFor();
  const captured=composeSyntheticAgoraInviteRisk(identity,NOW,base);
  assert.ok(captured);
  for(const item of base){
    if(item.kind==="synthetic_presence_check_v1") item.workerPresence="offline";
    if(item.kind==="synthetic_availability_check_v1") item.workerAvailability="busy";
    if(item.kind==="synthetic_mutual_blocks_check_v1") {
      item.blockedByCaller=true;
      item.blockedByWorker=true;
    }
    if(item.kind==="synthetic_rate_check_v1") item.rateGate="deny";
    if(item.kind==="synthetic_connection_check_v1") item.privacyApproved=false;
    item.expiresAtMs=NOW;
  }
  assert.deepEqual(captured,{
    kind:"synthetic_invite_risk_v1",...identity,
    checkedAtMs:NOW-10,expiresAtMs:DEADLINE,...allowed,
  });
  assert.ok(Object.isFrozen(captured));
  assert.equal(composeSyntheticAgoraInviteRisk(identity,NOW,base),null,
    "later mutated sources cannot silently retain valid stale timestamps");
});
