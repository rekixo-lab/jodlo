import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp,mkdir,cp,rm,symlink,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {publicPolicyTemplate,publicPolicyScopeHash,validatePublicPolicy,renderPublicPolicies,
  writePublicPolicyCandidate,verifyPublicPolicyCandidate} from "./prepare-public-policies.mjs";

const root=fileURLToPath(new URL("../",import.meta.url)),commit="a".repeat(40);
const now=Date.parse("2026-11-25T13:00:00.000Z");
const shell=await readFile(join(root,"apps/web/index.html"),"utf8");
const bilingual=(en="Fixture-only reviewed text for a synthetic test.",hi="यह केवल परीक्षण के लिए काल्पनिक समीक्षा का पाठ है।")=>({en,hi});
// Fixtures are never written to the repository's publication output.
function manifest(sourceCommit=commit){
  const m=publicPolicyTemplate(sourceCommit);m.effectiveDate="2026-11-25";
  m.operator={name:bilingual("Fixture Operator","काल्पनिक संचालक"),address:bilingual(),jurisdiction:bilingual()};
  m.contact={supportEmail:"support@jodlo-fixture.org",privacyEmail:"privacy@jodlo-fixture.org",deletionEmail:"deletion@jodlo-fixture.org",
    supportHours:bilingual(),complaintProcess:bilingual(),responseDays:7};
  m.minimumAge=18;m.features={calls:true,billing:true,accountDeletion:true};
  for(const k of Object.keys(m.retention))if(k!=="callHistoryDays")m.retention[k]=bilingual();
  m.deletion={completionDays:30,identityVerification:bilingual(),retainedExceptions:bilingual()};
  m.refundPolicy=bilingual();m.termsAdditional=bilingual();
  return approve(m);
}
function approve(m){
  const scope=publicPolicyScopeHash(m);
  for(const role of ["owner","legal","bilingual"])m.approvals[role]={reviewer:role==="owner"?"rekixo-lab":"fixture-"+role,
    decision:"approve_publication",scopeSha256:scope,reviewedAt:"2026-11-25T12:00:00.000Z",evidenceUrl:"https://github.com/rekixo-lab/jodlo/pull/987654"};
  return m;
}
const validate=m=>validatePublicPolicy(m,{sourceCommit:commit,now});

test("policy template invents no contact, operator or approval and cannot render",()=>{
  const m=publicPolicyTemplate(commit);
  assert.equal(m.operator.name.en,"");assert.equal(m.contact.supportEmail,"");
  assert.equal(m.minimumAge,null);assert.equal(m.approvals.owner.decision,"");
  assert.equal(m.approvals.legal.reviewer,"");assert.doesNotMatch(JSON.stringify(m),/@|approve_publication/);
  assert.throws(()=>validate(m));assert.throws(()=>renderPublicPolicies(m,shell,{sourceCommit:commit,now}));
});

test("only complete source-bound owner/legal/bilingual evidence passes structural review",()=>{
  const proof=validate(manifest());
  assert.equal(proof.ownerApprovalSupplied,true);assert.equal(proof.publicationAuthorized,false);
  assert.equal(proof.evidenceAuthentication,"MANUAL_REVIEW_REQUIRED");
  for(const change of [
    m=>m.approvals.owner.decision=false,m=>m.approvals.legal.decision="pending",m=>delete m.approvals.bilingual,
    m=>m.approvals.owner.reviewer="someone-else",m=>m.approvals.legal.scopeSha256="b".repeat(64),
    m=>m.approvals.owner.evidenceUrl="https://github.com/another/repo/pull/1",
    m=>m.approvals.owner.reviewedAt="2026-11-26T12:00:00.000Z",
    m=>m.sourceCommit="b".repeat(40),m=>m.effectiveDate="2026-11-26",
    m=>m.contact.supportHours.en="Changed content invalidates approvals.",
  ]){const m=manifest();change(m);assert.throws(()=>validate(m));}
});

test("missing, placeholder, secret-channel and unsupported policy inputs fail closed",()=>{
  for(const change of [
    m=>m.operator.name.en="Your Company",m=>m.operator.name.hi="English only",
    m=>m.contact.supportEmail="support@example.com",m=>m.contact.deletionEmail="deletion@domain.invalid",
    m=>m.contact.privacyEmail="hello@site.org\nBcc:other@site.org",m=>m.contact.privacyEmail="x@site.org?body=payload",
    m=>m.contact.responseDays=0,m=>m.minimumAge=17,m=>m.retention.callHistoryDays=30,
    m=>m.retention.backups.en="TBD",m=>m.deletion.identityVerification.hi="",m=>m.deletion.completionDays=null,
    m=>m.refundPolicy.en="placeholder",m=>m.features.billing="true",m=>m.features.unreviewed=true,
    m=>m.googlePrivateKey="secret",m=>m.websiteOrigin="https://another-site.org",
    m=>m.effectiveDate="2026-02-30",m=>delete m.termsAdditional,
  ]){const m=manifest();change(m);assert.throws(()=>publicPolicyScopeHash(m));}
});

test("rendered owner text is escaped and all final data flows have direct bilingual pages",()=>{
  const m=manifest();m.operator.name.en='Fixture & <script>bad()</script> "Name"';
  m.termsAdditional.en="Literal <img src=x onerror=alert(1)> & terms cannot execute.";approve(m);
  const {documents,proof}=renderPublicPolicies(m,shell,{sourceCommit:commit,now});
  assert.deepEqual(Object.keys(documents),["index.html","privacy.html","terms.html","deletion.html","help.html"]);
  for(const [name,html] of Object.entries(documents)){
    const page=name==="index.html"?"home":name.slice(0,-5);
    assert.match(html,new RegExp('<body data-default-page="'+page+'">'));
    assert.equal((html.match(new RegExp('<section data-page-panel="'+page+'">',"g"))??[]).length,2);
    assert.match(html,/Fixture &amp; &lt;script&gt;bad\(\)&lt;\/script&gt; &quot;Name&quot;/);
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html,/href="\.\/styles\.css"/);assert.match(html,/src="\.\/app\.js"/);
    assert.doesNotMatch(html,/<form\b|<iframe\b|<img src=x|<script>bad|Development-stage help|not a final Privacy Policy/);
    assert.match(html,/data-language-panel="hi"/);assert.match(html,/data-language-panel="en"/);
  }
  const html=documents["privacy.html"];
  for(const detail of [/Cloudflare Workers and D1/,/Agora/,/Firebase Cloud Messaging/,/Google Play/,/Raw purchase tokens are not stored/,
    /Saved and Hidden service references stay on your phone/,/90-day retention/,/provider records or backups/,/does not implement call-audio recording/])assert.match(html,detail);
  assert.match(documents["deletion.html"],/mailto:deletion@jodlo-fixture\.org\?subject=JODLO%20account%20deletion%20request/);
  assert.match(documents["deletion.html"],/without reinstalling the app/);
  assert.equal(proof.publicationAuthorized,false);
});

test("feature-disabled wording is explicit and modified shells cannot introduce submission",()=>{
  const m=manifest();m.features={calls:false,billing:false,accountDeletion:false};approve(m);
  const {documents}=renderPublicPolicies(m,shell,{sourceCommit:commit,now});
  assert.match(documents["privacy.html"],/Internet calling and call notifications are not enabled/);
  assert.match(documents["privacy.html"],/Digital minute purchases are not enabled/);
  assert.match(documents["deletion.html"],/in-app account deletion is not enabled/);
  for(const bad of [shell.replace("JODLO_POLICY_EN_PRIVACY_BEGIN","MARKER_REMOVED"),shell+"<form></form>",shell+'<iframe src="./x"></iframe>'])
    assert.throws(()=>renderPublicPolicies(m,bad,{sourceCommit:commit,now}));
});

async function withFixtureRepo(run){
  const dir=await mkdtemp(join(tmpdir(),"jodlo-policy-test-"));
  try{
    await mkdir(join(dir,"apps"));await cp(join(root,"apps/web"),join(dir,"apps/web"),{recursive:true});
    await writeFile(join(dir,".gitignore"),".local-release\n");
    const git=args=>execFileSync("git",args,{cwd:dir,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
    git(["init","-q"]);git(["add","."]);
    git(["-c","user.name=Fixture","-c","user.email=fixture@jodlo-fixture.org","commit","-qm","Synthetic policy test fixture"]);
    await run(dir,git(["rev-parse","HEAD"]));
  }finally{await rm(dir,{recursive:true,force:true});}
}

test("writer is local, exact-commit, clean-source only; integrity catches tampering and added files",async()=>{
  await withFixtureRepo(async(dir,sha)=>{
    assert.equal((await verifyPublicPolicyCandidate(dir,sha)).status,"missing");
    const m=manifest(sha);const result=await writePublicPolicyCandidate(m,{root:dir,now});
    assert.equal(result.providerRequests,0);assert.equal(result.publicationAuthorized,false);
    assert.equal((await verifyPublicPolicyCandidate(dir,sha)).status,"passed");
    assert.equal((await verifyPublicPolicyCandidate(dir,"b".repeat(40))).status,"invalid");
    const page=join(dir,result.directory,"privacy.html"),original=await readFile(page);
    await writeFile(page,"tampered");assert.equal((await verifyPublicPolicyCandidate(dir,sha)).status,"invalid");
    await writeFile(page,original);
    const extra=join(dir,result.directory,"owner-private.json");await writeFile(extra,"not-for-publication");
    assert.equal((await verifyPublicPolicyCandidate(dir,sha)).status,"invalid");await unlink(extra);
    await assert.rejects(writePublicPolicyCandidate(m,{root:dir,now}),/already exists/);
    await writeFile(join(dir,"apps/web/index.html"),shell+"<!-- Uncommitted change -->");
    await assert.rejects(writePublicPolicyCandidate(m,{root:dir,now}),/exact reviewed source/);
  });
});

test("policy evidence rejects symlinked files and writer rejects a redirected output directory",async()=>{
  await withFixtureRepo(async(dir,sha)=>{
    const result=await writePublicPolicyCandidate(manifest(sha),{root:dir,now});
    const page=join(dir,result.directory,"privacy.html");await unlink(page);
    await symlink(join(dir,"apps/web/index.html"),page);
    assert.equal((await verifyPublicPolicyCandidate(dir,sha)).status,"invalid");
  });
  await withFixtureRepo(async(dir,sha)=>{
    const target=await mkdtemp(join(tmpdir(),"jodlo-policy-outside-"));
    try{await symlink(target,join(dir,".local-release"));await assert.rejects(writePublicPolicyCandidate(manifest(sha),{root:dir,now}),/Unsafe private release directory/);}
    finally{await rm(target,{recursive:true,force:true});}
  });
});
