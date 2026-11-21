/**
 * One shared, fail-closed boundary for read-only Google Play provider responses.
 * Callers keep their own authorization/HTTP status/purchase-state checks.
 * This utility never sends a request, stores purchase details or grants credit.
 */
export async function withinPlayDeadline<T>(
  work: () => Promise<T>, remainingMs: () => number,
): Promise<T> {
  const wait = remainingMs();
  if (!Number.isFinite(wait) || wait <= 0) throw Error("Play provider deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Play provider deadline")), wait);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Validate Content-Length AND the actual byte stream under the same deadline.
 * Malformed JSON, invalid UTF-8, missing streams and oversized bodies throw;
 * an upstream purchase checker must translate those into an unavailable result.
 */
export async function readPlayBoundedJson(
  response: Response, remainingMs: () => number, maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error("Invalid Play response limit");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw Error("Play provider oversized body");
  if (!response.body) throw Error("Play provider missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await withinPlayDeadline(() => reader.read(), remainingMs);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) throw Error("Play provider oversized stream");
      chunks.push(item.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const part of chunks) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(combined));
}
