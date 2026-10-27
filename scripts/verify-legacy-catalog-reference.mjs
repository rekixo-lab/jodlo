/**
 * Read-only, zero-dependency integrity check for the founder-supplied historical
 * Finworkar public catalog snapshot stored in JODLO.
 *
 * This file is never imported into the API, seeded into D1, or deployed.
 * JODLO still has ONLY Hindi and English and no automatically approved pilots.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const archive=join(root,"docs/reference/data/finworkar-catalog-bilingual-2026-10-27.json.gz");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const sizes={groups:28,families:206,categories:889,services:7267};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

async function main() {
  const gz=await readFile(archive);
  if(gz.length!==379486||digest(gz)!=="c7a7e206490e191ec16ba4cf883a825018746e6e9b35ef1de8b4549d9f38c735")
    throw Error("Archived bilingual catalog gzip byte/hash mismatch");
  const raw=gunzipSync(gz);
  if(raw.length!==3563179||digest(raw)!=="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375")
    throw Error("Archived bilingual catalog JSON byte/hash mismatch");
  const d=JSON.parse(raw.toString("utf8"));
  if(d.kind!=="JODLO_BILINGUAL_REFERENCE_ONLY_NOT_A_LIVE_SEED"||
     d.source?.sha256!=="e9716a2fc9ed069ed45761842d4e697b25f0fb32cf698e4647b0edb16ad117e3"||
     JSON.stringify(d.languagePolicy)!==JSON.stringify(["en","hi"]))
    throw Error("Unapproved catalog provenance/language or operational state");
  const ids={};
  for(const [level,expected] of Object.entries(sizes)) {
    const records=d.collections?.[level];
    if(!Array.isArray(records)||records.length!==expected)throw Error("Catalog count mismatch: "+level);
    ids[level]=new Map();
    for(const doc of records) {
      if(typeof doc.id!=="string"||!doc.id||ids[level].has(doc.id)||
         typeof doc.name_en!=="string"||!doc.name_en.trim()||
         typeof doc.name_hi!=="string"||!doc.name_hi.trim())
        throw Error("Missing/duplicate IDs or bilingual names in "+level);
      if(own(doc,"nameLocalized")||own(doc,"hinglishAliases")||
         own(doc,"iconUrl")||own(doc,"contact")||own(doc,"name_hi_Latn"))
        throw Error("Unsafe old language/asset/PII field in bilingual catalog");
      ids[level].set(doc.id,doc);
    }
  }
  for(const family of d.collections.families)
    if(!ids.groups.has(family.groupId))throw Error("Orphan family "+family.id);
  for(const cat of d.collections.categories) {
    const family=ids.families.get(cat.familyId);
    if(!family||family.groupId!==cat.groupId||!ids.groups.has(cat.groupId))
      throw Error("Broken category ancestry "+cat.id);
  }
  const counts=new Map();
  for(const service of d.collections.services) {
    const cat=ids.categories.get(service.categoryId);
    if(!cat||service.groupId!==cat.groupId||service.familyId!==cat.familyId)
      throw Error("Broken service ancestry "+service.id);
    counts.set(cat.id,(counts.get(cat.id)??0)+1);
  }
  for(const cat of d.collections.categories)
    if(cat.serviceCount!==counts.get(cat.id))
      throw Error("Incorrect child service count "+cat.id);
  const invalidCategories=d.collections.categories
    .filter(cat=>!/^[A-Za-z0-9_-]{1,64}$/.test(cat.id)).map(x=>x.id);
  if(JSON.stringify(invalidCategories)!==JSON.stringify(["farmer-helper-मजदूर"]))
    throw Error("Unexpected unresolved JODLO category ID mapping");
  if(ids.groups.get("education-advisory")?.status!=="disabled_needs_population"||
     own(ids.groups.get("environment-utilities"),"status"))
    throw Error("Legacy group-state review evidence changed");
  console.log("Finworkar bilingual reference verified: 28 groups, 206 families, 889 categories, 7267 services; no JODLO seed.");
}

main().catch(e=>{console.error(e.message);process.exitCode=1;});
