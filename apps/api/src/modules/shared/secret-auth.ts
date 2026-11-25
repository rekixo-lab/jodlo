/** Fixed-format operator credentials only. Never accepts an app session as an
 * administrative credential, and never exposes a configured secret. */
export function equalOperatorSecret(candidate:string|null,secret:string|undefined):boolean{
  if(!secret||!/^[a-f0-9]{64}$/.test(secret)||!candidate||!/^[a-f0-9]{64}$/.test(candidate))return false;
  let difference=0;
  for(let i=0;i<64;i++)difference|=candidate.charCodeAt(i)^secret.charCodeAt(i);
  return difference===0;
}
