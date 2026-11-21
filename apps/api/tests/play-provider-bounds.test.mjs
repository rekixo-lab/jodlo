import assert from "node:assert/strict";
import test from "node:test";
import { readPlayBoundedJson, withinPlayDeadline } from
  "../src/modules/interactions/play-provider-bounds.ts";

const budget = () => 500;

test("shared Play response boundary accepts bounded valid JSON", async () => {
  assert.deepEqual(await readPlayBoundedJson(new Response('{"ok":true}'),budget,1024),
    {ok:true});
  assert.deepEqual(await readPlayBoundedJson(new Response('null'),budget,4),null);
});

test("shared Play reader rejects fabricated lengths, streamed overflow, invalid JSON and UTF-8", async () => {
  const bad = [
    new Response("{}",{headers:{"Content-Length":"1025"}}),
    new Response("{}",{headers:{"Content-Length":"garbage"}}),
    new Response("x".repeat(1025)),
    new Response("{not-json}"),
    new Response(Uint8Array.from([0xc3,0x28])),
    new Response(null),
  ];
  for (const response of bad) {
    await assert.rejects(readPlayBoundedJson(response,budget,1024));
  }
});

test("one deadline bounds stalled JSON streams and auth callbacks", async () => {
  const start=performance.now();
  await assert.rejects(withinPlayDeadline(async()=>new Promise(()=>{}),()=>35));
  await assert.rejects(readPlayBoundedJson(new Response(new ReadableStream({start(){}})),()=>35,100));
  assert.ok(performance.now()-start<1500);
  await assert.rejects(withinPlayDeadline(async()=>true,()=>0));
});
