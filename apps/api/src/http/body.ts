/** Bounded JSON reader protects authentication endpoints from large request bodies. */
export async function readGoogleLoginBody(request: Request): Promise<string | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) return null;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let pos = 0;
    for (const chunk of chunks) { joined.set(chunk, pos); pos += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (Object.keys(obj).length !== 1 || typeof obj.idToken !== "string") return null;
    return obj.idToken;
  } catch {
    return null;
  }
}
