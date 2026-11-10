import { importPKCS8, SignJWT } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REFRESH_MARGIN_MS = 60_000;
const MAX_REFRESH_MS = 3_000;
type RefreshedToken = Readonly<{token: string; expiresAt: number}>;

type FcmServiceAccount = Readonly<{
  email: string;
  privateKey: string;
  keyId?: string;
}>;

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
  const privateKey = account.privateKey.replaceAll("\\n", "\n");
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/i.test(account.email) ||
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

      const response = await request(TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return null;
      }

      const result: unknown = await response.json();
      if (result === null || typeof result !== "object") return null;
      const {access_token, token_type, expires_in} = result as Record<string, unknown>;
      if (typeof access_token !== "string" || access_token.length > 4096 ||
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
