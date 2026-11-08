/**
 * Narrow M-005 PRE-APPROVAL CI tripwire.
 *
 * The founder has approved Agora in-app Internet AUDIO as first contact
 * (ADR-0013) and a separate, revocable default-OFF worker opt-in (ADR-0014).
 * The 14 operational policy decisions in the M-005 register remain PENDING.
 *
 * This tests that the docs cannot silently present these as approved, and
 * that some easily detected live-call routes and vendor dependencies cannot
 * appear before deliberate founder review. It is NOT a general security
 * scanner, proof of authenticated presence, a production feature flag, or a
 * substitute for a human approval / release gate. Keep it local-only.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDefault=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const M005_PENDING_DECISIONS=Object.freeze([
  "P01","P02","P03","P04",
  "B01","B02","A01","A02",
  "T01","T02","D01","D02",
  "U01","S01",
]);
const expected=new Set(M005_PENDING_DECISIONS);
const paths=Object.freeze({
  register:"docs/M005_AGORA_OPERATIONAL_DECISIONS.md",
  previous:"docs/M005_DECISION_PROPOSAL.md",
  audio:"docs/decisions/0013-agora-ip-voice-calling.md",
  optin:"docs/decisions/0014-explicit-worker-agora-call-opt-in.md",
  router:"apps/api/src/http/router.ts",
  contact:"apps/api/src/modules/interactions/contact-safety.ts",
  pkg:"package.json",
  apiPkg:"apps/api/package.json",
});
async function read(root,path,errors){
  try { return await readFile(join(root,path),"utf8"); }
  catch { errors.push("Missing required M-005 source: "+path);return null; }
}
function detectVendorDependencies(raw,label,errors,allowControlledSigner=false){
  if(raw===null)return null;
  let pkg;
  try {pkg=JSON.parse(raw);}
  catch {
    errors.push(label+": malformed package JSON");
    return null;
  }
  if(!pkg || typeof pkg!=="object" || Array.isArray(pkg)){
    errors.push(label+": malformed package object");
    return null;
  }
  for(const section of ["dependencies","devDependencies","optionalDependencies","peerDependencies"]){
    const deps=pkg[section];
    if(deps && typeof deps==="object"){
      for(const key of Object.keys(deps)){
        if (allowControlledSigner && section==="dependencies" &&
            key==="agora-token" && deps[key]==="2.0.7") continue;
        if(/(^agora(?:$|[-_])|^@agora[./-]|^@agora\.io\/)/i.test(key))
          errors.push(label+": Agora SDK/provider dependency requires M-006 approval: "+key);
      }
    }
  }
  return pkg;
}
export async function auditM005OperationalApprovals(root=rootDefault){
  const errors=[];
  const sources={};
  for(const [key,path] of Object.entries(paths))
    sources[key]=await read(root,path,errors);

  const proposal=sources.register;
  let rows=[];
  if(proposal!==null){
    if(!/\bSTATUS:\s*DRAFT\s*\/\s*NOT APPROVED\b/i.test(proposal))
      errors.push("M-005 operational register must stay DRAFT / NOT APPROVED");
    if(!/^## Founder decision register — ALL items below remain PENDING$/m.test(proposal))
      errors.push("M-005 operational register must retain its explicit PENDING heading");
    if(!/^\|\s*ID \/ choice required\s*\|.*\|\s*Status\s*\|$/m.test(proposal))
      errors.push("M-005 operational register requires the per-row Status column");
    const seen=new Set();
    for(const line of proposal.split("\n")){
      const match=/^\|\s*\*\*([A-Z]\d{2})\s+—/.exec(line);
      if(!match)continue;
      const id=match[1];
      rows.push(id);
      if(seen.has(id))errors.push("Duplicate M-005 decision: "+id);
      seen.add(id);
      if(!expected.has(id))errors.push("Unknown M-005 decision: "+id);
      if(line.split("|").at(-2)?.trim()!=="PENDING")
        errors.push("M-005 decision needs explicit founder review: "+id+" must remain PENDING");
    }
    for(const id of M005_PENDING_DECISIONS){
      if(!seen.has(id))errors.push("Missing M-005 operational decision: "+id);
    }
    if(!proposal.includes("ADR-0013") || !proposal.includes("ADR-0014") ||
       !/Agora in-app Internet AUDIO/i.test(proposal))
      errors.push("M-005 operational register must retain the accepted Agora audio and worker opt-in boundaries");
  }
  const previous=sources.previous;
  if(previous!==null){
    if(!/Current binding updates — 2026-11-01/.test(previous) ||
       !/\*\*First contact APPROVED:\*\* Direct \*\*Agora in-app Internet AUDIO call\*\*/.test(previous) ||
       !/\*\*Worker call consent APPROVED:\*\* Separate default-OFF/.test(previous) ||
       !previous.includes("M005_AGORA_OPERATIONAL_DECISIONS.md"))
      errors.push("Historic M-005 proposal must not lose accepted Agora audio/opt-in update or pending decision link");
    if(/^- Customer first sends an availability request vs direct calling/m.test(previous))
      errors.push("Historic undecided first-contact bullet must not be reintroduced");
  }
  const audio=sources.audio;
  if(audio!==null && (!/Status:\s*ACCEPTED founder clarification/i.test(audio) ||
      !/in-app Internet voice calling powered by Agora RTC/i.test(audio) ||
      !/not require, collect, store, display or disclose a worker's mobile number/i.test(audio)))
    errors.push("ADR-0013 approved Agora audio / no worker phone number must remain binding");
  const optin=sources.optin;
  if(optin!==null && (!/Status:\s*ACCEPTED founder decision/i.test(optin) ||
      !/default is OFF/i.test(optin) ||
      !/worker may disable the setting at any time/i.test(optin)))
    errors.push("ADR-0014 approved revocable default-OFF worker opt-in must remain binding");

  const router=sources.router;
  if(router!==null &&
    /(["'\x60])\/api\/v1\/(?:calls?|rtc|signaling|voice)(?:\/[a-z0-9_-]+)*\1/i.test(router))
    errors.push("Live calling route is unapproved while M-005 operational decisions are PENDING");

  const contact=sources.contact;
  if(contact!==null &&
      /M-005 now selects direct telephone call as the FIRST contact/i.test(contact))
    errors.push("Outdated PSTN first-contact claim contradicts ADR-0013");

  let allowControlledSigner=false;
  if (sources.pkg && /"agora-token"\s*:\s*"2\.0\.7"/.test(sources.pkg)) {
    const manual=await read(root,"docs/MANUAL_ACTIONS.md",errors);
    allowControlledSigner=Boolean(manual?.includes("M-006 controlled Agora signer approved") &&
      router?.includes('env.CALL_MEDIA_VERIFICATION_ENABLED === "1"'));
  }
  const pkg=detectVendorDependencies(sources.pkg,"package.json",errors,allowControlledSigner);
  detectVendorDependencies(sources.apiPkg,"apps/api/package.json",errors);
  if(pkg){
    if(typeof pkg.scripts?.["founder:check"]!=="string" ||
       !pkg.scripts["founder:check"].includes("verify-m005-operational-approvals.mjs"))
      errors.push("founder:check must enforce M-005 operational approval tripwire");
    if(typeof pkg.scripts?.test!=="string" ||
       !pkg.scripts.test.includes("verify-m005-operational-approvals.test.mjs"))
      errors.push("npm test must exercise M-005 operational approval tripwire fixtures");
  }
  return {errors,pendingIds:rows};
}
const self=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(self){
  const {errors,pendingIds}=await auditM005OperationalApprovals();
  if(errors.length){
    for(const error of errors)process.stderr.write("M-005 approval gate: "+error+"\n");
    process.exitCode=1;
  }else{
    process.stdout.write(
      "M-005 safety gate OK: "+pendingIds.length+
      " operational decisions PENDING; Agora audio/default-OFF opt-in remain binding.\n",
    );
  }
}
