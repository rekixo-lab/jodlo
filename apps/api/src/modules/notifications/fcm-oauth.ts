import { importPKCS8, SignJWT } from "jose";
import { readBodyChunkUntil } from "../../http/body.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REFRESH_MARGIN_MS = 60_000;
const MAX_REFRESH_MS = 3_000;
const MAX_TOKEN_RESPONSE_BYTES = 8192;
type RefreshedToken = Readonly<{token: string; expiresAt: number}>;

type FcmServiceAccount = Readonly<{
  email: string;
  privateKey: string;
  keyId?: string;
}>;

/** Bound bytes as well as time. response.json() can allocate an arbitrarily
 * large response before the refresh timer wins, and keeps a stalled stream
 * alive after that timer returns. Neither is needed for a small OAuth token. */
async function readOAuthResponse(response: Response, deadline: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_TOKEN_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw Error("Invalid FCM OAuth response size");
  }
  if (!response.body) throw Error("Missing FCM OAuth response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await readBodyChunkUntil(reader, deadline);
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_TOKEN_RESPONSE_BYTES) throw Error("Oversized FCM OAuth response");
      chunks.push(item.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* timed-out read is still pending */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}

/** Keep credentials server-side. Share one refresh per Worker isolate and
 * never serve a token after the expiry reported by Google's token endpoint.
 */
export function createFcmAccessTokenSource(
  account: FcmServiceAccount, request: typeof fetch = fetch,
  timeoutMs = MAX_REFRESH_MS,
): () => Promise<string | null> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REFRESH_MS) {
    throw new Error("Invalid FCM OAuth deadline");
  }
  if (!account || typeof account.email !== "string" || typeof account.privateKey !== "string")
    throw new Error("Invalid FCM service account configuration");
  const privateKey = account.privateKey.replaceAll("\\n", "\n");
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/i.test(account.email) ||
      account.email.length > 256 || privateKey.length > 10_000 ||
      !privateKey.startsWith("-----BEGIN PRIVATE KEY-----") ||
      (account.keyId !== undefined && !/^[a-z0-9_-]{1,128}$/i.test(account.keyId))) {
    throw new Error("Invalid FCM service account configuration");
  }
  let key: ReturnType<typeof importPKCS8> | undefined;
  let cached: {token: string; expiresAt: number} | undefined;
  let pending: Promise<string | null> | undefined;

  // This function NEVER mutates the shared cache. A timed-out attempt can
  // finish late, but must not overwrite the result of a newer refresh.
  async function refresh(): Promise<RefreshedToken | null> {
    const deadline = Date.now() + timeoutMs;
    try {
      const signingKey = await (key ??= importPKCS8(privateKey, "RS256"));
      const now = Date.now();
      const issuedAt = Math.floor(now / 1000);
      const assertion = await new SignJWT({scope: MESSAGING_SCOPE})
        .setProtectedHeader({alg: "RS256", typ: "JWT", kid: account.keyId})
        .setIssuer(account.email)
        .setAudience(TOKEN_URL)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 300)
        .sign(signingKey);

      if (Date.now() >= deadline) return null;
      const response = await request(TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return null;
      }

      const result: unknown = await readOAuthResponse(response, deadline);
      if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
      const {access_token, token_type, expires_in} = result as Record<string, unknown>;
      if (typeof access_token !== "string" || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(access_token) ||
          typeof token_type !== "string" || token_type.toLowerCase() !== "bearer" ||
          typeof expires_in !== "number" || !Number.isSafeInteger(expires_in) ||
          expires_in <= 0 || expires_in > 3600) return null;
      const expiresAt = now + expires_in * 1000;
      if (Date.now() >= expiresAt) return null;
      return {token: access_token, expiresAt};
    } catch {
      return null;
    }
  }

  async function boundedRefresh(): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound the ENTIRE signing + OAuth fetch + response.json flow, not
      // merely the network fetch. A mock/transport ignoring AbortSignal or
      // stalled JSON stream must not permanently poison the shared pending
      // refresh for this Worker isolate.
      const result = await Promise.race<RefreshedToken | null>([
        refresh(),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      if (!result || Date.now() >= result.expiresAt) return null;
      // Commit only a timely, fully validated response. Late stale refresh
      // completions may not change the cached token after this deadline.
      cached = result;
      return result.token;
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return async () => {
    if (cached && Date.now() + REFRESH_MARGIN_MS < cached.expiresAt) return cached.token;
    return pending ??= boundedRefresh().finally(() => { pending = undefined; });
  };
}
