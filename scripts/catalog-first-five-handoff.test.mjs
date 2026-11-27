import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {renderPinnedFirstFiveSheet,
  assertPublishedFirstFiveSheet} from "./catalog-first-five-handoff.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("on-demand first-five reviewer worksheet includes the complete pinned source without obsolete notes",()=>{
  const published=renderPinnedFirstFiveSheet();
  assert.match(published,/UNAPPROVED \/ REVIEW ONLY/u);
  assert.match(published,/Qualified signoffs: 0; founder approvals: 0; production activations: 0; SQL generated: 0/u);
  assert.match(published,/This page: 5 Categories \/ 48 complete original Services/u);
  assert.equal(published.split("| Source Service ID |").length-1,5);
  assert.match(published,/ac-technician/u);
  assert.match(published,/laptop-repair/u);
  assert.match(published,/Original हिन्दी/u);
});

test("tampering or adding fake clearance to published review snapshot fails closed",()=>{
  const original=renderPinnedFirstFiveSheet();
  for(const changed of [
    original.slice(0,-10),
    original.replace("UNAPPROVED / REVIEW ONLY","APPROVED"),
    original.replace("production activations: 0","production activations: 1"),
    original+"\nCategory activation allowed\n",
    original.replace("ac-technician","invented-trade"),
  ]){
    assert.notEqual(changed,original);
    assert.throws(()=>assertPublishedFirstFiveSheet(changed,original));
  }
});

test("first-five CLI is read-only and does not accept deploy, SQL or approval options",()=>{
  const script=resolve(ROOT,"scripts/catalog-first-five-handoff.mjs");
  const okay=spawnSync(process.execPath,[script,"--check"],{
    cwd:ROOT,encoding:"utf8",timeout:90000,maxBuffer:20_000_000});
  assert.equal(okay.status,0,okay.stderr);
  assert.match(okay.stdout,/0 approvals\/SQL/u);
  for(const option of ["--approve","--seed","--deploy","--write","--limit=889"]){
    const bad=spawnSync(process.execPath,[script,option],{
      cwd:ROOT,encoding:"utf8",timeout:90000});
    assert.notEqual(bad.status,0,option);
  }
});

test("explicit external worksheet checking rejects changed or forged review text",()=>{
  const dir=mkdtempSync(join(tmpdir(),"jodlo-first-five-"));
  try{
    const path=join(dir,"worksheet.md"),expected=renderPinnedFirstFiveSheet();
    writeFileSync(path,expected);
    const check=()=>spawnSync(process.execPath,[resolve(ROOT,"scripts/catalog-first-five-handoff.mjs"),"--check",path],{
      cwd:ROOT,encoding:"utf8",timeout:90000,maxBuffer:20_000_000});
    assert.equal(check().status,0);
    writeFileSync(path,expected.replace("UNAPPROVED / REVIEW ONLY","APPROVED"));
    assert.notEqual(check().status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
