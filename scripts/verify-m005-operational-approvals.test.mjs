import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditM005OperationalApprovals, M005_PENDING_DECISIONS } from "./verify-m005-operational-approvals.mjs";

const DRAFT="**STATUS: DRAFT / NOT APPROVED — 2026-11-01.**";
const HEADER="## Founder decision register — ALL items below remain PENDING";
const TABLE="| ID / choice required | Working proposal (NOT approved) | Alternative | Gate | Status |";
const IDS=Array.from(M005_PENDING_DECISIONS);
const line=id=>"| **"+id+" — future choice** | Proposal NOT approved | Decide later | M-005 | PENDING |";
const docs=()=>[
  "# M-005 — synthetic founder decision pack",
  DRAFT,HEADER,
  "ADR-0013: Direct Agora in-app Internet AUDIO; ADR-0014: default OFF.",
  TABLE,"| --- | --- | --- | --- | --- |",
  ...IDS.map(line),
].join("\n");
const baseline=()=>({
  "docs/M005_AGORA_OPERATIONAL_DECISIONS.md":docs(),
  "docs/M005_DECISION_PROPOSAL.md":[
    "## Current binding updates — 2026-11-01",
    "- **First contact APPROVED:** Direct **Agora in-app Internet AUDIO call**.",
    "- **Worker call consent APPROVED:** Separate default-OFF worker choice.",
    "[Pending choices](M005_AGORA_OPERATIONAL_DECISIONS.md)",
  ].join("\n"),
  "docs/decisions/0013-agora-ip-voice-calling.md":[
    "**Status: ACCEPTED founder clarification — 2026-10-31.**",
    "The first contact is in-app Internet voice calling powered by Agora RTC.",
    "JODLO must not require, collect, store, display or disclose a worker's mobile number.",
  ].join("\n"),
  "docs/decisions/0014-explicit-worker-agora-call-opt-in.md":[
    "**Status: ACCEPTED founder decision — 2026-10-31.**",
    "The call setting default is OFF. The worker may disable the setting at any time.",
  ].join("\n"),
  "apps/api/src/http/router.ts":'if (url.pathname==="/api/v1/listings") return;',
  "apps/api/src/modules/interactions/contact-safety.ts":
    "First contact is Agora in-app Internet audio, not a telephone call.",
  "package.json":JSON.stringify({scripts:{
    "founder:check":"node scripts/verify-m005-operational-approvals.mjs",
    "test":"node --test scripts/verify-m005-operational-approvals.test.mjs",
  }}),
  "apps/api/package.json":JSON.stringify({name:"@jodlo/api"}),
});
async function fixture(change){
  const root=await mkdtemp(join(tmpdir(),"jodlo-m005-ci-gate-"));
  try{
    const files=baseline();
    if(change)change(files);
    for(const[path,source]of Object.entries(files)){
      const file=join(root,path);
      await mkdir(dirname(file),{recursive:true});
      await writeFile(file,source);
    }
    return await auditM005OperationalApprovals(root);
  }finally{await rm(root,{force:true,recursive:true});}
}
const errors=result=>result.errors.join("\n");

test("exact 14 M-005 choices PENDING plus accepted Agora audio and default-OFF pass",async()=>{
  const result=await fixture();
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.pendingIds,IDS);
});
test("silently declaring any proposed choice APPROVED fails the founder gate",async()=>{
  for(const id of ["P01","P02","B01","A01","T01","D02","S01"]){
    const result=await fixture(files=>{
      const path="docs/M005_AGORA_OPERATIONAL_DECISIONS.md";
      files[path]=files[path].replace(line(id),line(id).replace(/PENDING \|$/,"APPROVED |"));
    });
    assert.ok(errors(result).includes("M-005 decision needs explicit founder review: "+id+" must remain PENDING"));
  }
});
test("missing, duplicate or rogue founder decision is denied",async()=>{
  const missing=await fixture(files=>{
    const p="docs/M005_AGORA_OPERATIONAL_DECISIONS.md";
    files[p]=files[p].replace(line("P03"),"");
  });
  assert.match(errors(missing),/Missing M-005 operational decision: P03/);
  const duplicated=await fixture(files=>{
    files["docs/M005_AGORA_OPERATIONAL_DECISIONS.md"]+="\n"+line("B02");
  });
  assert.match(errors(duplicated),/Duplicate M-005 decision: B02/);
  const rogue=await fixture(files=>{
    files["docs/M005_AGORA_OPERATIONAL_DECISIONS.md"]+="\n"+line("X99");
  });
  assert.match(errors(rogue),/Unknown M-005 decision: X99/);
});
test("removing DRAFT status, pending heading or per-row Status column is denied",async()=>{
  const variants=[
    f=>{const p="docs/M005_AGORA_OPERATIONAL_DECISIONS.md";
      f[p]=f[p].replace(DRAFT,"**STATUS: ACCEPTED.**");},
    f=>{const p="docs/M005_AGORA_OPERATIONAL_DECISIONS.md";
      f[p]=f[p].replace(HEADER,"## Founder approved");},
    f=>{const p="docs/M005_AGORA_OPERATIONAL_DECISIONS.md";
      f[p]=f[p].replace(TABLE,"| Choice | Proposal | Alternative | Gate |");},
  ];
  for(const mutate of variants)assert.notEqual((await fixture(mutate)).errors.length,0);
});
test("old telephone interpretation cannot supersede binding Agora decision",async()=>{
  const wrong=await fixture(files=>{
    files["docs/decisions/0013-agora-ip-voice-calling.md"]="**Status: DRAFT.** Calling a telephone number.";
    files["docs/decisions/0014-explicit-worker-agora-call-opt-in.md"]="**Status: DRAFT.** The preference defaults ON.";
    files["docs/M005_DECISION_PROPOSAL.md"]="- Customer first sends an availability request vs direct calling";
    files["apps/api/src/modules/interactions/contact-safety.ts"]="M-005 now selects direct telephone call as the FIRST contact";
  });
  assert.match(errors(wrong),/ADR-0013 approved Agora audio/);
  assert.match(errors(wrong),/ADR-0014 approved revocable default-OFF/);
  assert.match(errors(wrong),/Historic M-005 proposal/);
  assert.match(errors(wrong),/Historic undecided first-contact bullet/);
  assert.match(errors(wrong),/Outdated PSTN first-contact/);
});
test("live call route and vendor SDK package are forbidden before M-005 approval",async()=>{
  const wrong=await fixture(files=>{
    files["apps/api/src/http/router.ts"]+=' if(url.pathname==="/api/v1/calls/accept")return;';
    files["package.json"]=JSON.stringify({scripts:{
      "founder:check":"node scripts/verify-m005-operational-approvals.mjs",
      "test":"node scripts/verify-m005-operational-approvals.test.mjs",
    },dependencies:{"agora-rtc-sdk-ng":"*"}});
    files["apps/api/package.json"]=JSON.stringify({dependencies:{"@agora.io/server-gateway":"*"}});
  });
  assert.match(errors(wrong),/Live calling route is unapproved/);
  assert.match(errors(wrong),/Agora SDK\/provider dependency.*agora-rtc-sdk-ng/);
  assert.match(errors(wrong),/Agora SDK\/provider dependency.*@agora.io\/server-gateway/);
});
test("removing CI tripwire from founder:check or npm test is refused",async()=>{
  const result=await fixture(files=>{
    files["package.json"]=JSON.stringify({scripts:{
      "founder:check":"node scripts/verify-founder-gates.mjs",
      "test":"node --test apps/api/tests/*.test.mjs",
    }});
  });
  assert.match(errors(result),/founder:check must enforce/);
  assert.match(errors(result),/npm test must exercise/);
});
test("missing register, missing ADR and invalid package JSON fail closed",async()=>{
  const result=await fixture(files=>{
    delete files["docs/M005_AGORA_OPERATIONAL_DECISIONS.md"];
    delete files["docs/decisions/0014-explicit-worker-agora-call-opt-in.md"];
    files["apps/api/package.json"]="{not-json";
  });
  assert.match(errors(result),/Missing required M-005 source: docs\/M005_AGORA_OPERATIONAL_DECISIONS.md/);
  assert.match(errors(result),/Missing required M-005 source: docs\/decisions\/0014/);
  assert.match(errors(result),/apps\/api\/package.json: malformed package JSON/);
});
test("actual JODLO repository passes strictly pending founder policy gate",async()=>{
  const result=await auditM005OperationalApprovals();
  assert.deepEqual(result.errors,[],errors(result));
  assert.deepEqual([...result.pendingIds].sort(),[...M005_PENDING_DECISIONS].sort());
});
