import assert from "node:assert/strict";
import test from "node:test";
import {openLocalDatabase} from "./helpers/local-db.mjs";
import {issueSession,sessionHash} from "../src/modules/identity/sessions.ts";
import {recordTrustedCallCreditEvent} from "../src/modules/interactions/private-call-credits.ts";
import {stageTrustedPlayConsumable} from "../src/modules/interactions/play-consumable-outbox.ts";
import {recordTrustedPlayRevocation} from "../src/modules/interactions/google-play-rtdn-fences.ts";
import {registerPlayRefundPolicy,releaseReviewedPlayRefundHold} from "../src/modules/interactions/play-refund-review.ts";
import {handleRequest} from "../src/http/router.ts";

test("export v4 includes only current owner's financial records and bounded usage without provider secrets",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    db.exec("INSERT INTO accounts(id) VALUES('export-payer'),('export-other')");
    const bearer=(await issueSession(adapter,"export-payer")).accessToken;
    await recordTrustedCallCreditEvent(adapter,{accountId:"export-payer",sourceKeyHash:"a".repeat(64),kind:"purchase_grant",seconds:300,createdAtMs:Date.now()});
    await recordTrustedCallCreditEvent(adapter,{accountId:"export-other",sourceKeyHash:"b".repeat(64),kind:"purchase_grant",seconds:600,createdAtMs:Date.now()});
    const response=await handleRequest(new Request("https://example.invalid/api/v1/me/data-export?version=4",{headers:{Authorization:"Bearer "+bearer}}),{DB:adapter});
    assert.equal(response.status,200);const data=(await response.json()).data;
    assert.equal(data.schemaVersion,4);assert.equal(data.minuteBalance.length,1);
    assert.equal(data.minuteBalance[0].availableSeconds,300);assert.equal(data.minuteBalance[0].reservedSeconds,0);
    assert.equal(data.minuteActivity.length,1);assert.equal(data.minuteActivity[0].seconds,300);
    for(const key of ["serviceDetails","servicePhotos","serviceReports","serviceAppeals","purchaseStatus","callUsage","refundReviews"])assert.ok(Array.isArray(data[key]));
    const raw=JSON.stringify(data);
    for(const hidden of [bearer,"a".repeat(64),"b".repeat(64),"export-other","purchaseToken","source_key_hash"])assert.ok(!raw.includes(hidden));
    assert.equal((await handleRequest(new Request("https://example.invalid/api/v1/me/data-export?version=4"),{DB:adapter})).status,401);
    assert.equal((await handleRequest(new Request("https://example.invalid/api/v1/me/data-export?version=5",{headers:{Authorization:"Bearer "+bearer}}),{DB:adapter})).status,400);
  }finally{db.close();}
});

test("export v4 projects real purchase, call and refund records with the same spendable balance and no other owner evidence",async()=>{
  const {db,adapter}=openLocalDatabase();
  try{
    const now=Date.now()-10000,owner="complete-export-owner",other="complete-export-other";
    db.prepare("INSERT INTO accounts(id) VALUES(?),(?)").run(owner,other);
    const bearer=(await issueSession(adapter,owner)).accessToken;
    const otherBearer=(await issueSession(adapter,other)).accessToken;
    const ownerHash=await sessionHash(bearer),otherHash=await sessionHash(otherBearer);
    const refundPolicy={version:"jodlo-play-refund-hold-v1",approvalSha256:"a".repeat(64)};
    assert.equal(await registerPlayRefundPolicy(adapter,refundPolicy,now),true);
    const products=new Map([["jodlo.minutes5",5],["jodlo.minutes10",10],["jodlo.minutes15",15]]);
    const source=["1".repeat(64),"2".repeat(64),"3".repeat(64)];
    for(const [index,accountId,tokenHash,minutes] of [[0,owner,ownerHash,5],[1,owner,ownerHash,10],[2,other,otherHash,15]]){
      assert.equal(await stageTrustedPlayConsumable(adapter,{accountId,sourceKeyHash:source[index],
        productId:"jodlo.minutes"+minutes,seconds:minutes*60,createdAtMs:now+index},products,
        {sessionHash:tokenHash,policyVersion:"jodlo-play-minutes-v1",approvalSha256:"b".repeat(64),purchasedAtMs:now-1000}),"applied");
    }
    await recordTrustedCallCreditEvent(adapter,{accountId:owner,sourceKeyHash:"4".repeat(64),
      kind:"verified_usage",seconds:30,createdAtMs:now+3});
    const usageId="11111111-2222-4333-8444-555555555555",otherUsageId="66666666-7777-4888-8999-aaaaaaaaaaaa";
    const usageInsert=db.prepare("INSERT INTO call_usage_sessions(invitation_id,caller_account_id,receiver_account_id,"+
      "policy_version,approval_hash,source_key_hash,reserved_seconds,authorized_from_ms,authorized_until_ms,settle_after_ms) "+
      "VALUES(?,?,?,'agora-overlap-v1',?,?,60,?,?,?)");
    usageInsert.run(usageId,owner,other,"c".repeat(64),"5".repeat(64),now+4,now+60004,now+180004);
    usageInsert.run(otherUsageId,other,owner,"c".repeat(64),"6".repeat(64),now+5,now+60005,now+180005);
    const revisionBefore=db.prepare("SELECT revision FROM call_credit_balances WHERE account_id=?").get(owner).revision;
    for(const index of [0,2])assert.equal(await recordTrustedPlayRevocation(adapter,{
      sourceKeyHash:source[index],reason:"voided_purchase",recordedAtMs:now+6+index}),"applied");
    const request=()=>new Request("https://example.invalid/api/v1/me/data-export?version=4",{headers:{Authorization:"Bearer "+bearer}});
    const response=await handleRequest(request(),{DB:adapter});
    assert.equal(response.status,200);
    const {data}=await response.json();
    assert.deepEqual(data.minuteBalance,[{availableSeconds:510,reservedSeconds:60,revision:revisionBefore+1}]);
    assert.deepEqual(data.minuteActivity,[
      {kind:"purchase_grant",seconds:300,occurredAtMs:now},
      {kind:"purchase_grant",seconds:600,occurredAtMs:now+1},
      {kind:"verified_usage",seconds:30,occurredAtMs:now+3},
    ]);
    assert.deepEqual(data.purchaseStatus.map(({updatedAtMs,...purchase})=>purchase),[
      {productId:"jodlo.minutes5",seconds:300,status:"void_hold"},
      {productId:"jodlo.minutes10",seconds:600,status:"ready"},
    ]);
    assert.ok(data.purchaseStatus.every(p=>Number.isSafeInteger(p.updatedAtMs)&&p.updatedAtMs>=now));
    assert.deepEqual(data.callUsage,[{startedAtMs:now+4,endedAtMs:null,status:"active",reservedSeconds:60,chargedSeconds:0}]);
    assert.deepEqual(data.refundReviews,[{productId:"jodlo.minutes5",seconds:300,reason:"voided_purchase",
      status:"open",openedAtMs:now+6,resolvedAtMs:null}]);
    const raw=JSON.stringify(data);
    for(const hidden of [bearer,otherBearer,ownerHash,otherHash,other,usageId,otherUsageId,...source,
      "4".repeat(64),"5".repeat(64),"6".repeat(64),"a".repeat(64),"b".repeat(64),"c".repeat(64),
      "jodlo.minutes15","source_key_hash","approval_hash","client_seq","event_hash"])
      assert.ok(!raw.includes(hidden),"export must omit "+hidden);
    // A reviewed release changes spendable seconds/revision but creates no
    // extra financial activity and does not remove the revoked purchase.
    assert.equal(await releaseReviewedPlayRefundHold(adapter,{sourceKeyHash:source[0],policy:refundPolicy,
      resolutionEvidenceHash:"d".repeat(64),resolvedAtMs:now+20}),"applied");
    const released=(await (await handleRequest(request(),{DB:adapter})).json()).data;
    assert.deepEqual(released.minuteBalance,[{availableSeconds:810,reservedSeconds:60,revision:revisionBefore+2}]);
    assert.equal(released.minuteActivity.length,3);
    assert.equal(released.refundReviews[0].status,"released");
    assert.equal(released.refundReviews[0].resolvedAtMs,now+20);
    assert.equal(released.purchaseStatus[0].status,"void_hold");
    assert.ok(!JSON.stringify(released).includes("d".repeat(64)));
  }finally{db.close();}
});
