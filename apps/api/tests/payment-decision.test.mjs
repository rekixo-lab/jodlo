import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
const root=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const read=path=>readFileSync(resolve(root,path),"utf8");
test("payment strategy documented consistently across project decisions",()=>{
  for(const path of ["README.md","docs/PROJECT.md","docs/PRODUCT_REQUIREMENTS.md","docs/ARCHITECTURE.md","docs/ROADMAP.md","docs/STATUS.md","docs/MANUAL_ACTIONS.md","docs/PAYMENTS.md","docs/decisions/0002-google-pay-and-play-billing.md","docs/reference/LEGACY_MAPPING.md"]){
    const doc=read(path);assert.match(doc,/Google Pay/,path);assert.match(doc,/Google Play Billing/,path);
  }
});
test("merchant checkout is not misrepresented as implemented",()=>{
  assert.match(read("docs/STATUS.md"),/No payment API, checkout, ledger/);
  assert.match(read("docs/PAYMENTS.md"),/No production checkout is implemented/);
  assert.match(read("docs/PAYMENTS.md"),/server-to-server|server-side|bank\/PSP/);
});
