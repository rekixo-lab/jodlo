/** Operator workstation client. No command runs implicitly and no credential
 * is accepted on argv or printed. Use JODLO_OPERATIONS_KEY in the environment.
 * Readiness and case listing are read-only; resolving a reviewed hold requires
 * an explicit --apply and an actual nonempty case-evidence file. An explicit
 * pending-refund-decide queues one provider recommendation on authenticated
 * RTDN redelivery; pending-refund-record only records external handling. */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";

const ORIGIN="https://api.jodlo.rekixo.com";
const digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
async function boundedResponse(response,signal){
  const maximum=256*1024;
  const declared=response.headers.get("content-length");
  if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>maximum){
    response.body?.cancel().catch(()=>{});
    throw Error("Operator response too large");
  }
  if(!response.body)throw Error("Invalid operator response");
  const reader=response.body.getReader(),chunks=[];
  let total=0,finished=false;
  const abort=()=>{reader.cancel().catch(()=>{});};
  signal.addEventListener("abort",abort,{once:true});
  try{
    while(true){
      signal.throwIfAborted();
      const {done,value}=await reader.read();
      signal.throwIfAborted();
      if(done){finished=true;break;}
      total+=value.byteLength;
      if(total>maximum)throw Error("Operator response too large");
      chunks.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
    catch{throw Error("Invalid operator response");}
  }finally{
    signal.removeEventListener("abort",abort);
    if(!finished)reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
export async function runOperations(args,env=process.env,deps={}){
  const [command,...rest]=args;
  if(!["readiness","refund-list","refund-resolve","pending-refund-list","pending-refund-record","pending-refund-decide"].includes(command))
    throw Error("Use readiness | refund-list | refund-resolve | pending-refund-list | pending-refund-record | pending-refund-decide");
  if(!digest(env.JODLO_OPERATIONS_KEY))throw Error("Set the operator credential in JODLO_OPERATIONS_KEY; never put it on the command line");
  const opts={};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];
    if(key==="--apply"){if(opts.apply)throw Error("Duplicate option");opts.apply=true;continue;}
    if(key==="--check"){if(opts.check)throw Error("Duplicate option");opts.check=true;continue;}
    if(!["--expected-sha","--after","--case","--evidence","--preference","--sample-content-provided"].includes(key)||
        i+1>=rest.length||Object.hasOwn(opts,key))throw Error("Invalid option");
    opts[key]=rest[++i];
  }
  const get=deps.request??fetch;
  let path,body;
  if(command==="readiness"){
    if(!/^[a-f0-9]{40}$/.test(opts["--expected-sha"]??"")||Object.keys(opts).some(k=>!["--expected-sha","check"].includes(k)))
      throw Error("readiness requires --expected-sha COMMIT and optional --check");
    path="/api/v1/operations/readiness";
  }else if(command==="refund-list"||command==="pending-refund-list"){
    if(Object.keys(opts).some(k=>k!=="--after")||Object.hasOwn(opts,"--after")&&!digest(opts["--after"]))throw Error(command+" accepts only --after CASE_ID");
    path="/api/v1/operations/"+(command==="refund-list"?"refund-reviews":"pending-refund-reviews")+(opts["--after"]?"?after="+opts["--after"]:"");
  }else{
    const decision=command==="pending-refund-decide";
    const allowed=decision?["apply","--case","--evidence","--preference","--sample-content-provided"]:["apply","--case","--evidence"];
    if(!opts.apply||!digest(opts["--case"])||typeof opts["--evidence"]!=="string"||!opts["--evidence"]||
        Object.keys(opts).length!==allowed.length||Object.keys(opts).some(name=>!allowed.includes(name))||
        decision&&(!["APPROVE","DECLINE","NEUTRAL"].includes(opts["--preference"])||
          !["true","false"].includes(opts["--sample-content-provided"])))
      throw Error(decision?
        "pending-refund-decide requires --case CASE_ID --preference APPROVE|DECLINE|NEUTRAL --sample-content-provided true|false --evidence REVIEW_FILE --apply; this queues one provider recommendation on authenticated RTDN redelivery":
        command+" requires --case CASE_ID --evidence REVIEW_FILE --apply");
    const evidence=await (deps.readEvidence??readFile)(opts["--evidence"]);
    if(evidence.length<20||evidence.length>1024*1024)throw Error("Case review evidence must contain 20 bytes to 1 MiB");
    path="/api/v1/operations/"+(command==="refund-resolve"?"refund-reviews":"pending-refund-reviews");
    body=JSON.stringify({caseKey:opts["--case"],evidenceSha256:createHash("sha256").update(evidence).digest("hex"),
      ...(decision?{refundPreference:opts["--preference"],sampleContentProvided:opts["--sample-content-provided"]==="true"}:{})});
  }
  const signal=AbortSignal.timeout(10000);
  const response=await get(ORIGIN+path,{method:body?"POST":"GET",redirect:"error",signal,
    headers:{Authorization:"Bearer "+env.JODLO_OPERATIONS_KEY,...(body?{"Content-Type":"application/json"}:{})},...(body?{body}:{})});
  if(!response.ok){response.body?.cancel().catch(()=>{});throw Error("Operator API rejected request (HTTP "+response.status+")");}
  const result=await boundedResponse(response,signal);
  if(!result||result.ok!==true||!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw Error("Invalid operator response");
  if(command==="readiness"&&result.data.sourceCommit!==opts["--expected-sha"])
    throw Error("Live source version differs from the expected commit; release is not verified");
  if(command==="readiness"&&opts.check&&
      (result.data.schemaReady!==true||result.data.readiness?.ready!==true||
       !Array.isArray(result.data.readiness.configurationErrors)||result.data.readiness.configurationErrors.length))
    throw Error("Live configuration/schema readiness check failed; run readiness without --check to inspect. Provider acceptance still requires external evidence");
  return result.data;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runOperations(process.argv.slice(2)).then(data=>process.stdout.write(JSON.stringify(data,null,2)+"\n"))
    .catch(error=>{process.stderr.write(error instanceof Error?error.message+"\n":"Operator request failed\n");process.exitCode=1;});
}
