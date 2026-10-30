/** Maximum empty byte chunks tolerated before rejecting a malformed/unproductive
 * body stream. Neither login nor no-body routes may spin on endless zero bytes.
 */
const MAX_EMPTY_CHUNKS = 8;

/**
 * A hostile client can pause forever between bytes without sending any empty
 * chunks. Bound the COMPLETE body read, not each chunk separately: a peer
 * trickling one byte at a time must never extend the budget indefinitely.
 * These small identity/listing JSON routes do not accept file uploads.
 */
export const BODY_READ_DEADLINE_MS = 10_000;

export async function readBodyChunkUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Request body deadline exceeded");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Request body deadline exceeded")), remaining);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Real workerd can deliver a zero-byte POST/DELETE as a readable empty stream.
 * Never confuse a stream's presence with data. Fail closed on malformed,
 * locked, unreadable, or repeatedly empty streams.
 */
export async function hasEmptyBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = request.body.getReader();
    let emptyChunks = 0;
    const deadline = Date.now() + BODY_READ_DEADLINE_MS;
    while (true) {
      const { done, value } = await readBodyChunkUntil(reader, deadline);
      if (done) return true;
      if (!value || value.byteLength > 0 || ++emptyChunks > MAX_EMPTY_CHUNKS) {
        return false;
      }
    }
  } catch {
    // Never await hostile cancel() implementations; returning the error is bounded.
    if (reader) void reader.cancel().catch(() => {});
    return false;
  } finally {
    reader?.releaseLock();
  }
}

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
 * A malicious/unproductive source cannot accumulate unlimited empty chunks.
 */
async function readBoundedObject(request: Request, maxBytes: number):
  Promise<Record<string, unknown> | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) return null;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return null;
  if (!request.body) return null;

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let emptyChunks = 0;
  const deadline = Date.now() + BODY_READ_DEADLINE_MS;
  try {
    reader = request.body.getReader();
    while (true) {
      const { done, value } = await readBodyChunkUntil(reader, deadline);
      if (done) break;
      if (!value) return null;
      if (value.byteLength === 0) {
        if (++emptyChunks > MAX_EMPTY_CHUNKS) return null;
        continue;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        // A hostile stream's cancel() promise can hang; do not wait for it.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let pos = 0;
    for (const c of chunks) { joined.set(c, pos); pos += c.byteLength; }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    if (!ONE_STRING_FIELD_JSON.test(source)) return null;
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    if (reader) void reader.cancel().catch(() => {});
    return null;
  } finally {
    reader?.releaseLock();
  }
}

export async function readGoogleLoginBody(request: Request): Promise<string | null> {
  const obj = await readBoundedObject(request, 8192);
  if (!obj || Object.keys(obj).length !== 1 || typeof obj.idToken !== "string") return null;
  return obj.idToken;
}

/** Only category ID; arbitrary text, profile IDs, verification or GPS rejected. */
export async function readServiceListingBody(request: Request): Promise<string | null> {
  const obj = await readBoundedObject(request, 256);
  if (!obj || Object.keys(obj).length !== 1 || typeof obj.categoryId !== "string") return null;
  return obj.categoryId;
}
