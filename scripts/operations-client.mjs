/** Operator workstation client. No command runs implicitly and no credential
 * is accepted on argv or printed. Use JODLO_OPERATIONS_KEY in the environment.
 * Readiness and case listing are read-only; resolving a reviewed hold requires
 * an explicit --apply and an actual nonempty case-evidence file. */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";

const ORIGIN="https://api.jodlo.rekixo.com";
const digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
export async function runOperations(args,env=process.env,deps={}){
  const [command,...rest]=args;
  if(!["readiness","refund-list","refund-resolve"].includes(command))throw Error("Use readiness | refund-list | refund-resolve");
  if(!digest(env.JODLO_OPERATIONS_KEY))throw Error("Set the operator credential in JODLO_OPERATIONS_KEY; never put it on the command line");
  const opts={};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];
    if(key==="--apply"){if(opts.apply)throw Error("Duplicate option");opts.apply=true;continue;}
    if(!["--expected-sha","--after","--case","--evidence"].includes(key)||i+1>=rest.length||opts[key])throw Error("Invalid option");
    opts[key]=rest[++i];
  }
  const get=deps.request??fetch;
  let path,body;
  if(command==="readiness"){
    if(!/^[a-f0-9]{40}$/.test(opts["--expected-sha"]??"")||Object.keys(opts).length!==1)
      throw Error("readiness requires only --expected-sha COMMIT");
    path="/api/v1/operations/readiness";
  }else if(command==="refund-list"){
    if(Object.keys(opts).some(k=>k!=="--after")||opts["--after"]&&!digest(opts["--after"]))throw Error("refund-list accepts only --after CASE_ID");
    path="/api/v1/operations/refund-reviews"+(opts["--after"]?"?after="+opts["--after"]:"");
  }else{
    if(!opts.apply||!digest(opts["--case"])||typeof opts["--evidence"]!=="string"||Object.keys(opts).length!==3)
      throw Error("refund-resolve requires --case CASE_ID --evidence REVIEW_FILE --apply");
    const evidence=await (deps.readEvidence??readFile)(opts["--evidence"]);
    if(evidence.length<20||evidence.length>1024*1024)throw Error("Case review evidence must contain 20 bytes to 1 MiB");
    path="/api/v1/operations/refund-reviews";
    body=JSON.stringify({caseKey:opts["--case"],evidenceSha256:createHash("sha256").update(evidence).digest("hex")});
  }
  const response=await get(ORIGIN+path,{method:body?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(10000),
    headers:{Authorization:"Bearer "+env.JODLO_OPERATIONS_KEY,...(body?{"Content-Type":"application/json"}:{})},...(body?{body}:{})});
  if(!response.ok)throw Error("Operator API rejected request (HTTP "+response.status+")");
  const bytes=await response.arrayBuffer();if(bytes.byteLength>256*1024)throw Error("Operator response too large");
  const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(result.ok!==true||!result.data)throw Error("Invalid operator response");
  if(command==="readiness"&&result.data.sourceCommit!==opts["--expected-sha"])
    throw Error("Live source version differs from the expected commit; release is not verified");
  return result.data;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runOperations(process.argv.slice(2)).then(data=>process.stdout.write(JSON.stringify(data,null,2)+"\n"))
    .catch(error=>{process.stderr.write(error instanceof Error?error.message+"\n":"Operator request failed\n");process.exitCode=1;});
}
