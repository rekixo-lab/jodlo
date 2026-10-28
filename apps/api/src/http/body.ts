/** A single JSON string field is the entire permitted body for these routes.
 * JSON.parse silently collapses duplicate object keys, so counting keys AFTER
 * parsing cannot prove the client sent just one field. Verify the wire shape
 * BEFORE JSON.parse. The small JSON-string grammar preserves valid escapes
 * (including escaped keys) while rejecting a second key or nested values.
 */
const ONE_STRING_FIELD_JSON =
  /^\s*\{\s*"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*:\s*"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*\}\s*$/;

/** Bounded JSON parser reused by both authentication and service publication.
 * Rejects streaming overflow regardless of Content-Length. No logging payloads.
 */
async function readBoundedObject(request:Request,maxBytes:number):
  Promise<Record<string,unknown>|null> {
  const type=request.headers.get("Content-Type")??"";
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))return null;
  const declared=request.headers.get("Content-Length");
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))return null;
  if(!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();return null;}
      chunks.push(value);
    }
    const joined=new Uint8Array(size);
    let pos=0;
    for(const c of chunks){joined.set(c,pos);pos+=c.byteLength;}
    const source=new TextDecoder("utf-8",{fatal:true}).decode(joined);
    if(!ONE_STRING_FIELD_JSON.test(source))return null;
    const parsed:unknown=JSON.parse(source);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
    return parsed as Record<string,unknown>;
  } catch {return null;}
}

export async function readGoogleLoginBody(request:Request):Promise<string|null> {
  const obj=await readBoundedObject(request,8192);
  if(!obj||Object.keys(obj).length!==1||typeof obj.idToken!=="string")return null;
  return obj.idToken;
}

/** Only category ID; arbitrary text, profile IDs, verification or GPS rejected. */
export async function readServiceListingBody(request:Request):Promise<string|null> {
  const obj=await readBoundedObject(request,256);
  if(!obj||Object.keys(obj).length!==1||typeof obj.categoryId!=="string")return null;
  return obj.categoryId;
}
