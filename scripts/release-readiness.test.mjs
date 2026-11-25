import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm,symlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {releaseEvidenceTemplate,assessReleaseEvidence,RELEASE_EVIDENCE_GATES} from "./release-readiness.mjs";

const commitSha="a".repeat(40),now=Date.parse("2026-11-25T12:00:00.000Z");
async function fixture(action){
  const root=await mkdtemp(join(tmpdir(),"jodlo-evidence-test-"));
  try{
    await mkdir(join(root,".local-release/evidence"),{recursive:true});
    const content="SYNTHETIC TEST EVIDENCE. No real acceptance.\n";
    await writeFile(join(root,".local-release/evidence/fixture.txt"),content);
    const m=releaseEvidenceTemplate(commitSha);
    const row=m.items[0];Object.assign(row,{status:"passed",reviewer:"synthetic-reviewer",recordedAt:"2026-11-24T00:00:00.000Z",artifactPath:".local-release/evidence/fixture.txt",artifactSha256:createHash("sha256").update(content).digest("hex"),referenceUrl:"https://github.com/rekixo-lab/jodlo/actions/runs/1"});
    await action({root,m,row,options:{root,commitSha,now}});
  }finally{await rm(root,{recursive:true,force:true});}
}
test("default evidence is missing or pending and cannot become release approval",async()=>{
  const missing=await assessReleaseEvidence(null,{commitSha,now});
  assert.equal(missing.length,RELEASE_EVIDENCE_GATES.length);assert.ok(missing.every(x=>x.status==="missing"));
  const template=releaseEvidenceTemplate(commitSha);assert.ok(template.items.every(x=>x.status==="pending"&&x.artifactSha256===""));
  const result=await assessReleaseEvidence(template,{commitSha,now});assert.ok(result.every(x=>x.status==="pending"));
});
test("artifact integrity is recorded honestly without claiming authenticated approval",()=>fixture(async({m,options})=>{
  const result=await assessReleaseEvidence(m,options);
  assert.equal(result[0].status,"recorded");assert.match(result[0].detail,/independent acceptance/);
  assert.ok(result.slice(1).every(x=>x.status==="pending"));
  assert.equal(JSON.stringify(result).includes("synthetic-reviewer"),false);
}));
test("evidence from another commit is stale even if its artifact hash matches",()=>fixture(async({m,options})=>{
  m.commitSha="b".repeat(40);const result=await assessReleaseEvidence(m,options);
  assert.ok(result.every(x=>x.status==="stale"));
}));
test("changed and missing evidence files cannot satisfy acceptance",()=>fixture(async({root,m,options})=>{
  await writeFile(join(root,".local-release/evidence/fixture.txt"),"changed");
  assert.equal((await assessReleaseEvidence(m,options))[0].status,"digest_mismatch");
  await rm(join(root,".local-release/evidence/fixture.txt"));
  assert.equal((await assessReleaseEvidence(m,options))[0].status,"missing_artifact");
}));
test("future, missing, malformed, duplicate and secret-bearing evidence references fail closed",()=>fixture(async({m,options})=>{
  for(const edit of [
    c=>{c.items[0].recordedAt="2026-11-26T00:00:00.000Z";},c=>{c.items[0].recordedAt="2026-02-30T00:00:00.000Z";},
    c=>{c.items[0].reviewer="";},c=>{c.items[0].artifactSha256="0".repeat(64);},c=>{c.items[0].status="approved";},
    c=>{c.items[0].referenceUrl="https://secret@example.com/report";},c=>{c.items[0].referenceUrl="https://example.com/report?token=secret";},
    c=>{c.items[0].artifactPath="../../private-key.pem";},c=>{c.items[0].artifactPath=".local-release/evidence/../secret";},
    c=>{c.items[1].id=c.items[0].id;},c=>{c.items[0].id="invented-gate";},
  ]){const c=structuredClone(m);edit(c);await assert.rejects(()=>assessReleaseEvidence(c,options));}
}));
test("symlinks cannot redirect an evidence file or its private directory outside the allowed folder",()=>fixture(async({root,m,options})=>{
  await writeFile(join(root,"outside.txt"),"secret content must never be emitted");
  await rm(join(root,".local-release/evidence/fixture.txt"));
  await symlink(join(root,"outside.txt"),join(root,".local-release/evidence/fixture.txt"));
  assert.equal((await assessReleaseEvidence(m,options))[0].status,"missing_artifact");
  await rm(join(root,".local-release/evidence"),{recursive:true});
  await symlink(root,join(root,".local-release/evidence"));
  m.items[0].artifactPath=".local-release/evidence/outside.txt";
  assert.equal((await assessReleaseEvidence(m,options))[0].status,"missing_artifact");
}));
