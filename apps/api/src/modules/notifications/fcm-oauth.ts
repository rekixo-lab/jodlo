import { importPKCS8, SignJWT } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REFRESH_MARGIN_MS = 60_000;

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
): () => Promise<string | null> {
  const privateKey = account.privateKey.replaceAll("\\n", "\n");
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/i.test(account.email) ||
      !privateKey.startsWith("-----BEGIN PRIVATE KEY-----") ||
      (account.keyId !== undefined && !/^[a-z0-9_-]{1,128}$/i.test(account.keyId))) {
    throw new Error("Invalid FCM service account configuration");
  }
  let key: ReturnType<typeof importPKCS8> | undefined;
  let cached: {token: string; expiresAt: number} | undefined;
  let pending: Promise<string | null> | undefined;

  async function refresh(): Promise<string | null> {
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
        signal: AbortSignal.timeout(3000),
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
      cached = {token: access_token, expiresAt};
      return access_token;
    } catch {
      return null;
    }
  }

  return async () => {
    if (cached && Date.now() + REFRESH_MARGIN_MS < cached.expiresAt) return cached.token;
    return pending ??= refresh().finally(() => { pending = undefined; });
  };
}
