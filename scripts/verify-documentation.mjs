import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const required=[
"README.md","AGENTS.md","CONTRIBUTING.md","UPLOAD_INSTRUCTIONS.md","docs/PROJECT.md","docs/AI_HANDOFF.md","docs/STATUS.md","docs/ROADMAP.md","docs/ARCHITECTURE.md","docs/ARCHITECTURE_RESEARCH_20261027.md","docs/ANDROID_STRUCTURE.md","docs/CLOUDFLARE_INFRASTRUCTURE.md","docs/MODULE_BOUNDARIES.md","docs/PAYMENTS.md","docs/TESTING.md","docs/RELEASE_READINESS.md","docs/MANUAL_ACTIONS.md","docs/reference/LEGACY_MAPPING.md","docs/decisions/0001-cloudflare-modular-monolith.md","docs/decisions/0002-google-pay-and-play-billing.md","docs/decisions/0004-local-first-no-staging-until-production.md","docs/decisions/0003-native-android-single-activity.md"
];
async function walk(dir){let all=[];for(const item of await readdir(dir,{withFileTypes:true})){if(item.name.startsWith(".git")||item.name==="node_modules")continue;const p=join(dir,item.name);if(item.isDirectory())all.push(...await walk(p));else if(item.isFile()&&extname(p)===".md")all.push(p);}return all;}
async function main(){for(const p of required)assert.equal((await stat(join(root,p))).isFile(),true,"Missing "+p);
for(const path of ["README.md","AGENTS.md","docs/AI_HANDOFF.md","docs/STATUS.md"]){let t=await readFile(join(root,path),"utf8");for(const id of ["JODLO","com.rekixo.jodlo","jodlo.rekixo.com"])assert.ok(t.includes(id),path+" missing "+id);}
for(const path of ["README.md","AGENTS.md","docs/AI_HANDOFF.md"]){let t=await readFile(join(root,path),"utf8");assert.ok(t.includes("Google Pay")&&t.includes("Razorpay")&&/UI/.test(t)&&/approval|approve|consent|सहमति/.test(t),path+" missing owner gates");}
let links=0;for(const file of await walk(root)){const raw=await readFile(file,"utf8");const text=raw.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,"");for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){let href=match[1].trim().replace(/^<|>$/g,"").split("#")[0].split("?")[0];if(!href||/^(https?:\/\/|mailto:|tel:|data:)/i.test(href))continue;assert.ok(!href.startsWith("/"),"Absolute link "+href);const dest=resolve(dirname(file),decodeURIComponent(href));assert.ok(dest===root||dest.startsWith(root+"/"),"Link escapes repo: "+href);try{await stat(dest);}catch{throw Error("Broken relative link "+file+" => "+href)}links++;}}
process.stdout.write("JODLO docs: "+required.length+" required, "+links+" relative links valid.\n");}
main().catch(e=>{console.error(e.message);process.exitCode=1});
