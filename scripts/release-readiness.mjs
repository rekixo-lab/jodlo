/** Read-only, source-bound launch handoff. Never runs a release, reads secret
 * values, calls providers, or converts a supplied checklist into authorization.
 * Evidence artifacts stay in gitignored .local-release/evidence/.
 */
import {createHash} from "node:crypto";
import {readFile,readdir,realpath,lstat} from "node:fs/promises";
import {resolve,dirname,join,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {auditCITrustBoundary} from "./verify-ci-trust-boundary.mjs";
import {auditFounderGates} from "./verify-founder-gates.mjs";
import {verifyProductionConfig} from "./prepare-production-wrangler.mjs";
import {verifyDomainConfig} from "./prepare-api-custom-domain.mjs";
import {requiredOperationalSecrets} from "./production-operations.mjs";
import {verifyPublicPolicyCandidate} from "./prepare-public-policies.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const RELEASE_EVIDENCE_GATES=Object.freeze([
  {id:"foundation_android_ci",action:"Record green foundation, Android APK and unsigned AAB checks for this exact commit."},
  {id:"catalog_human_review",action:"Verify owner, Hindi/English and occupational review of the scoped remapped catalog manifest."},
  {id:"catalog_import_reversal",action:"Rehearse the approved catalog against a fresh backup; verify actual published hierarchy/search and reverse plan."},
  {id:"cloudflare_identity_schema",action:"Verify the dedicated JODLO Cloudflare account, D1 migrations, provider secret installation and policy hashes."},
  {id:"cloudflare_domains_version",action:"Confirm actual deployment commit, api.jodlo.rekixo.com TLS and jodlo.rekixo.com hosting; health alone is insufficient."},
  {id:"backup_restore",action:"Record a fresh D1 backup/bookmark and an isolated successful restore with schema and data integrity checks."},
  {id:"two_phone_calls_push",action:"Run controlled Customer/Worker Google login, listing, FCM and Agora calls on two authorized physical phones, including background/denied/reconnect cases."},
  {id:"verified_usage_ledger",action:"Confirm real signed Agora overlap events, bounded single minute deductions and network/hold/replay recovery."},
  {id:"play_console_products",action:"Confirm package ownership, closed-track eligibility, six approved consumables, Publisher/PubSub setup; owner enters prices at final upload."},
  {id:"play_purchase_refund_restore",action:"Run real Play closed-track purchase/pending/cancel/refund/restore/restart tests and verify one credit/consume and reviewed refund outcomes."},
  {id:"privacy_account_erasure",action:"Verify Google reauthentication and account deletion across D1, provider records, media, logs, backups and documented retention."},
  {id:"legal_support_moderation",action:"Approve final privacy/terms/refund/retention notices, qualified Worker claims, staffed support/moderation and appeals."},
  {id:"media_storage_capacity",action:"Approve bounded D1 JPEG storage or an explicitly implemented alternative; verify capacity, metadata removal, moderation and erasure."},
  {id:"physical_device_quality",action:"Check supported Android/OEM devices, Hindi/English accessibility, edge-to-edge/back, microphone/notifications, performance and crash recovery."},
  {id:"android_signing_release",action:"Use owner-controlled signing, explicit version and actual provider config; verify reproducible release AAB and install/restore behavior."},
  {id:"play_store_listing",action:"Finish Play listing/screenshots, privacy URL, Data Safety, content rating, app access and deletion declarations."},
  {id:"monitoring_rollback",action:"Verify operations readiness/version, sampled redacted logs, queue/abuse alerts, cost thresholds, retention jobs and incident rollback rehearsal."},
  {id:"closed_test_acceptance",action:"Record owner acceptance of the complete Customer→Worker→Call→Billing→Deletion journey and recovery on the closed track."},
  {id:"owner_release_authorization",action:"Record the final owner release decision for this commit and exact configured features after the other evidence is reviewed."},
]);
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const digest=data=>createHash("sha256").update(data).digest("hex");
function sourceSnapshot(root){
  const commitSha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
  if(!/^[a-f0-9]{40}$/.test(commitSha))throw Error("Repository commit unavailable");
  const changes=execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]});
  return {commitSha,workingTreeClean:!changes.trim()};
}
export function releaseEvidenceTemplate(commitSha){
  if(!/^[a-f0-9]{40}$/.test(commitSha))throw Error("A source commit is required");
  return {kind:"JODLO_RELEASE_EVIDENCE_V1",commitSha,items:RELEASE_EVIDENCE_GATES.map(({id})=>({id,status:"pending",reviewer:"",recordedAt:"",artifactPath:"",artifactSha256:"",referenceUrl:""}))};
}
/** A local artifact digest proves file integrity only, never provider success
 * or reviewer identity. Supplied evidence is always labelled RECORDED. */
export async function assessReleaseEvidence(evidence,{root=ROOT,commitSha,now=Date.now()}={}){
  const missing=()=>RELEASE_EVIDENCE_GATES.map(g=>({...g,status:"missing",detail:"Manual evidence has not been supplied."}));
  if(evidence===null||evidence===undefined)return missing();
  if(!exact(evidence,["kind","commitSha","items"])||evidence.kind!=="JODLO_RELEASE_EVIDENCE_V1"||
      !/^[a-f0-9]{40}$/.test(evidence.commitSha)||!Array.isArray(evidence.items)||evidence.items.length>RELEASE_EVIDENCE_GATES.length)
    throw Error("Invalid release evidence manifest");
  const rows=new Map();
  for(const row of evidence.items){
    if(!exact(row,["id","status","reviewer","recordedAt","artifactPath","artifactSha256","referenceUrl"])||
       !RELEASE_EVIDENCE_GATES.some(g=>g.id===row.id)||rows.has(row.id)||!["pending","passed","failed"].includes(row.status)||
       ["reviewer","recordedAt","artifactPath","artifactSha256","referenceUrl"].some(k=>typeof row[k]!=="string"||row[k].length>500||/[\u0000-\u001f\u007f]/u.test(row[k])))throw Error("Invalid or duplicate evidence entry");
    rows.set(row.id,row);
  }
  const results=[];
  for(const gate of RELEASE_EVIDENCE_GATES){
    const row=rows.get(gate.id);
    if(!row){results.push({...gate,status:"missing",detail:"Manual evidence has not been supplied."});continue;}
    if(evidence.commitSha!==commitSha){results.push({...gate,status:"stale",detail:"Evidence belongs to a different commit."});continue;}
    if(row.status!=="passed"){results.push({...gate,status:row.status,detail:row.status==="failed"?"Recorded acceptance failure must be resolved.":"Manual acceptance is pending."});continue;}
    if(!row.reviewer.trim()||row.reviewer!==row.reviewer.trim()||
      !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.recordedAt)||
      !Number.isFinite(Date.parse(row.recordedAt))||new Date(row.recordedAt).toISOString()!==row.recordedAt||Date.parse(row.recordedAt)>now||
      !/^[a-f0-9]{64}$/.test(row.artifactSha256)||/^0+$/.test(row.artifactSha256))throw Error("Claimed acceptance needs valid reviewer, date and artifact digest");
    if(row.referenceUrl){
      let url;try{url=new URL(row.referenceUrl);}catch{throw Error("Invalid evidence reference");}
      if(url.protocol!=="https:"||url.username||url.password||url.search)throw Error("Evidence references must be credential-free HTTPS without queries");
    }
    if(!/^\.local-release\/evidence\/[A-Za-z0-9][A-Za-z0-9_./-]{0,230}$/.test(row.artifactPath)||row.artifactPath.split("/").includes(".."))throw Error("Evidence file must be inside .local-release/evidence");
    let artifact;
    try{
      const privateDir=await lstat(join(root,".local-release")),evidenceDir=await lstat(join(root,".local-release/evidence"));
      if(!privateDir.isDirectory()||privateDir.isSymbolicLink()||!evidenceDir.isDirectory()||evidenceDir.isSymbolicLink())throw Error("Unsafe evidence directory");
      const allowed=await realpath(join(root,".local-release/evidence"));
      const path=join(root,row.artifactPath),stat=await lstat(path),actual=await realpath(path),rel=relative(allowed,actual);
      if(!stat.isFile()||stat.isSymbolicLink()||!rel||rel.startsWith("..")||isAbsolute(rel)||stat.size>20*1024*1024)throw Error("Unsafe evidence file");
      artifact=await readFile(actual);
    }catch{results.push({...gate,status:"missing_artifact",detail:"Referenced evidence file is missing or outside the bounded private evidence folder."});continue;}
    if(digest(artifact)!==row.artifactSha256){results.push({...gate,status:"digest_mismatch",detail:"Evidence file changed after its recorded digest."});continue;}
    results.push({...gate,status:"recorded",detail:"Local artifact integrity checked; its claim and reviewer still require independent acceptance review."});
  }
  return results;
}
async function configChecks(root,commitSha){
  const checks=[],paths=["apps/api/wrangler.production.generated.jsonc","apps/api/wrangler.production.domain.generated.jsonc"];
  const configs=[];
  for(const [i,path] of paths.entries()){
    try{
      const config=JSON.parse(await readFile(join(root,path),"utf8"));
      (i===0?verifyProductionConfig:verifyDomainConfig)(config);configs[i]=config;
      checks.push({id:i===0?"private_production_config":"exact_domain_config",status:"passed",detail:"Local structure checked; actual provider identity/deployment remains manual."});
    }catch(err){checks.push({id:i===0?"private_production_config":"exact_domain_config",status:err?.code==="ENOENT"?"missing":"invalid",detail:"Use the production config/domain preparation tools with actual owner settings."});}
  }
  if(configs[0]&&configs[1]){
    const {routes,...privatePart}=configs[1];
    checks.push({id:"domain_config_matches",status:JSON.stringify(privatePart)===JSON.stringify(configs[0])?"passed":"invalid",detail:"Public release config must match every private binding, flag, policy and schedule."});
  }
  if(configs[0]){
    checks.push({id:"operational_settings",status:configs[0].vars&&configs[0].triggers&&configs[0].observability?"passed":"missing",detail:"Feature flags, retention/usage schedules and sampled log policy must be explicit."});
  }
  checks.push(await verifyPublicPolicyCandidate(root,commitSha));
  return {checks,requiredSecretNames:configs[0]?requiredOperationalSecrets(configs[0]):[],enabledFeatures:configs[0]?Object.entries(configs[0].vars??{}).filter(([k,v])=>k.endsWith("_ENABLED")&&v==="1").map(([k])=>k):[]};
}
async function sourceChecks(root){
  const checks=[];
  for(const [id,audit] of [["workflow_trust_boundary",auditCITrustBoundary],["source_privacy_and_release_guards",auditFounderGates]]){
    const errors=await audit(root);checks.push({id,status:errors.length?"failed":"passed",detail:errors.length?errors.join("; "):"Current source guard passed; no provider or deployment was contacted."});
  }
  const db=new DatabaseSync(":memory:");
  try{
    db.exec("PRAGMA foreign_keys=ON");
    const files=(await readdir(join(root,"infra/migrations"))).filter(f=>/^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    if(!files.length||new Set(files.map(f=>f.slice(0,4))).size!==files.length)throw Error("Migration sequence collision");
    for(const file of files)db.exec(await readFile(join(root,"infra/migrations",file),"utf8"));
    if(db.prepare("PRAGMA foreign_key_check").all().length||db.prepare("PRAGMA quick_check").get().quick_check!=="ok")throw Error("Migration integrity failed");
    for(const table of ["catalog_import_batches","catalog_services","call_usage_sessions","play_consume_outbox"])db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
    checks.push({id:"empty_database_migrations",status:"passed",detail:"All migrations apply locally with integrity intact; production D1 is unverified."});
  }catch{checks.push({id:"empty_database_migrations",status:"failed",detail:"Local migration or required release schema check failed."});}finally{db.close();}
  return checks;
}
export async function collectReleaseReadiness({root=ROOT,evidence=null,now=Date.now()}={}){
  const source=sourceSnapshot(root),codeChecks=await sourceChecks(root),configuration=await configChecks(root,source.commitSha);
  const manualActions=await assessReleaseEvidence(evidence,{root,commitSha:source.commitSha,now});
  const allRecorded=manualActions.every(x=>x.status==="recorded");
  const localPass=codeChecks.every(x=>x.status==="passed")&&configuration.checks.every(x=>x.status==="passed");
  return {kind:"JODLO_RELEASE_READINESS_V1",source,codeChecks,configurationChecks:configuration.checks,
    enabledFeatures:configuration.enabledFeatures,requiredSecretNames:configuration.requiredSecretNames,manualActions,
    summary:{localChecksPassed:localPass,manualEvidenceRecorded:manualActions.filter(x=>x.status==="recorded").length,
      manualEvidenceRequired:manualActions.length,readyForOwnerReview:source.workingTreeClean&&localPass&&allRecorded,
      releaseAuthorized:false,providerConnectionsTested:false,productionChanges:0},
    evidenceBoundary:"Recorded artifacts are supplied evidence, not independently verified provider outcomes or authenticated approvals. This command does not run the full test suite or authorize release."};
}
async function main(args){
  if(args.length===1&&args[0]==="--evidence-template")return console.log(JSON.stringify(releaseEvidenceTemplate(sourceSnapshot(ROOT).commitSha),null,2));
  if(args.length===1&&args[0]==="--source-check"){
    const checks=await sourceChecks(ROOT);console.log(JSON.stringify({scope:"local_source_only",checks,releaseAuthorized:false},null,2));
    if(checks.some(c=>c.status!=="passed"))process.exitCode=1;return;
  }
  const opts=new Map();
  for(let i=0;i<args.length;i++){
    if(args[i]==="--check"||args[i]==="--json"){if(opts.has(args[i]))throw Error("Duplicate option");opts.set(args[i],true);}
    else if(args[i]==="--evidence"&&args[i+1]&&!opts.has(args[i]))opts.set(args[i],args[++i]);
    else throw Error("Unsupported readiness option");
  }
  let evidence=null;
  if(opts.has("--evidence")){const raw=await readFile(resolve(opts.get("--evidence")));if(raw.length>131072)throw Error("Evidence manifest too large");evidence=JSON.parse(raw.toString("utf8"));}
  const report=await collectReleaseReadiness({evidence});console.log(JSON.stringify(report,null,2));
  if(opts.has("--check")&&!report.summary.readyForOwnerReview)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{
  process.stderr.write("Release readiness could not validate local source/configuration/evidence. No provider request or deployment occurred; secret/input contents were not printed.\n");process.exitCode=1;
});
