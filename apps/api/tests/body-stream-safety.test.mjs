import assert from "node:assert/strict";
import test from "node:test";
import { hasEmptyBody, readGoogleLoginBody, readServiceListingBody, readBodyChunkUntil, BODY_READ_DEADLINE_MS } from "../src/http/body.ts";

const origin = "https://jodlo.rekixo.com/api/v1/me/listings";
const utf8 = new TextEncoder();
const empty = () => new Uint8Array(0);
const bytes = value => utf8.encode(value);

function streamingRequest(chunks, cancel) {
  let position = 0;
  const source = new ReadableStream({
    pull(controller) {
      if (position === chunks.length) controller.close();
      else controller.enqueue(chunks[position++]);
    },
    ...(cancel ? { cancel } : {}),
  });
  return new Request(origin, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: source,
    duplex: "half",
  });
}

test("zero-byte stream framing is bounded for no-body and one-member JSON routes", async () => {
  const maxAccepted = Array.from({ length: 8 }, empty);
  assert.equal(await hasEmptyBody(streamingRequest(maxAccepted)), true);
  assert.equal(await hasEmptyBody(streamingRequest([...maxAccepted, empty()])), false);
  assert.equal(await hasEmptyBody(streamingRequest([empty(), bytes(" ")])), false);
  assert.equal(await hasEmptyBody(streamingRequest([bytes("x")])), false);
  assert.equal(await hasEmptyBody(new Request(origin, { method: "POST" })), true);

  assert.equal(await readServiceListingBody(
    streamingRequest([empty(), bytes('{"categoryId":"fixture-only"}')])), "fixture-only");
  assert.equal(await readServiceListingBody(
    streamingRequest([...maxAccepted, bytes('{"categoryId":"fixture-only"}')])), "fixture-only");
  assert.equal(await readServiceListingBody(
    streamingRequest([...maxAccepted, empty(), bytes('{"categoryId":"fixture-only"}')])), null);
  assert.equal(await readGoogleLoginBody(
    streamingRequest([...maxAccepted, empty(), bytes('{"idToken":"fake-only"}')])), null);
  // Parsing still requires a bounded, single-field object; no side-effect or identity.
  assert.equal(await readGoogleLoginBody(
    streamingRequest([bytes('{"idToken":"fake-only"}')])), "fake-only");
});

test("locked and failing streams return denial, not uncaught 500 errors", async () => {
  const locked = streamingRequest([bytes('{"categoryId":"fixture-only"}')]);
  const reader = locked.body.getReader();
  try {
    assert.equal(await hasEmptyBody(locked), false);
    assert.equal(await readServiceListingBody(locked), null);
  } finally {
    reader.releaseLock();
  }
  const failing = () => streamingRequest([], undefined);
  const aborting = new ReadableStream({
    pull(controller) { controller.error(new Error("internal fixture sentinel")); },
  });
  const rejected = new Request(origin, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: aborting, duplex: "half" });
  assert.equal(await readServiceListingBody(rejected), null);
  assert.equal(await hasEmptyBody(failing()), true);
});

test("oversized JSON never waits indefinitely for an uncooperative stream cancellation", async () => {
  // A hostile ReadableStream may never resolve cancel(). The endpoint still
  // has to return a normal 400/null after exceeding its existing byte cap.
  const req = streamingRequest([new Uint8Array(300)], () => new Promise(() => {}));
  let timer;
  try {
    const value = await Promise.race([
      readServiceListingBody(req),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded parser waited on cancel()")), 2000);
      }),
    ]);
    assert.equal(value, null);
  } finally {
    clearTimeout(timer);
  }
});


function stalledRequest(prefix, cancel = () => new Promise(() => {})) {
  let pushed = false;
  const body = new ReadableStream({
    pull(controller) {
      if (!pushed && prefix !== null) {
        pushed = true;
        controller.enqueue(prefix);
      }
      // Never deliver a terminal chunk, even when the caller cancels.
      return new Promise(() => {});
    },
    cancel,
  });
  return new Request(origin, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body, duplex: "half",
  });
}

test("body reader has a total deadline even when no new chunk ever arrives", async () => {
  const stream = new ReadableStream({pull() { return new Promise(() => {}); }});
  const reader = stream.getReader();
  try {
    await assert.rejects(readBodyChunkUntil(reader, Date.now() - 1), /deadline exceeded/);
    await assert.rejects(readBodyChunkUntil(reader, Date.now() + 35), /deadline exceeded/);
  } finally { reader.releaseLock(); }
});

test("a peer that stops sending body bytes cannot hold auth/listing handlers forever", {
  timeout: BODY_READ_DEADLINE_MS + 8_000,
}, async () => {
  const start = Date.now();
  // Run concurrently to avoid tripling the time needed for this regression.
  const responses = await Promise.all([
    hasEmptyBody(stalledRequest(empty())),
    readServiceListingBody(stalledRequest(bytes('{"categoryId":'))),
    readGoogleLoginBody(stalledRequest(bytes('{"idToken":'))),
  ]);
  assert.deepEqual(responses, [false, null, null]);
  assert.ok(Date.now() - start <= BODY_READ_DEADLINE_MS + 5_000);
});

test("normal complete requests remain accepted after adding a body deadline", async () => {
  assert.equal(await hasEmptyBody(streamingRequest([empty()])), true);
  assert.equal(await readServiceListingBody(
    streamingRequest([empty(), bytes('{"categoryId":"fixture-only"}')])), "fixture-only");
  assert.equal(await readGoogleLoginBody(
    streamingRequest([bytes('{"idToken":"synthetic"}')])), "synthetic");
});
