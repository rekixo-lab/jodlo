import { importPKCS8, SignJWT } from "jose";

const GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token";
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_TIMEOUT_MS = 3_000;

type PlayServiceAccount = Readonly<{
  email: string;
  privateKey: string;
}>;

/** Isolated server-only Google Play service-account OAuth.
 * No Play Console credentials or products are configured by default.
 * The signing key is never returned, persisted, logged or sent as JSON.
 */
export function createPlayAndroidPublisherAccessTokenSource(
  account: PlayServiceAccount,
  request: typeof fetch = fetch,
  timeoutMs = TOKEN_TIMEOUT_MS,
): () => Promise<string | null> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > TOKEN_TIMEOUT_MS ||
      !account || typeof account.email !== "string" ||
      typeof account.privateKey !== "string")
    throw Error("Invalid Play OAuth configuration");
  const privateKey = account.privateKey.replaceAll("\\n", "\n");
  if (!/^[a-z0-9._-]{3,100}@[a-z0-9.-]{3,160}\.iam\.gserviceaccount\.com$/i.test(account.email) ||
      privateKey.length > 10_000 ||
      !privateKey.startsWith("-----BEGIN PRIVATE KEY-----"))
    throw Error("Invalid Play OAuth service account");
  let pending: Promise<string | null> | undefined;
  let cache: {token:string;expiry:number} | null = null;

  async function refresh(): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      const key = await importPKCS8(privateKey, "RS256");
      const now = Math.floor(Date.now()/1000);
      const assertion = await new SignJWT({scope: PLAY_SCOPE})
        .setProtectedHeader({alg:"RS256",typ:"JWT"})
        .setIssuer(account.email)
        .setAudience(GOOGLE_OAUTH_URL)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(key);
      const response = await request(GOOGLE_OAUTH_URL, {
        method:"POST", redirect:"error",
        signal: AbortSignal.timeout(timeoutMs),
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({
          grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        return null;
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096))
        return null;
      const raw = await response.text();
      if (raw.length > 4096) return null;
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data))
        return null;
      const fields = data as Record<string, unknown>;
      if (fields.token_type !== "Bearer" ||
          typeof fields.access_token !== "string" ||
          !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(fields.access_token) ||
          !Number.isSafeInteger(fields.expires_in) ||
          (fields.expires_in as number) < 90 ||
          (fields.expires_in as number) > 3600)
        return null;
      const expiry = Date.now() + (fields.expires_in as number)*1000;
      return {token:fields.access_token,expiry};
    })();
    try {
      const outcome = await Promise.race([
        work,
        new Promise<null>(resolve => {
          timer=setTimeout(()=>resolve(null),timeoutMs);
        }),
      ]);
      if (!outcome || Date.now()+60_000>=outcome.expiry)return null;
      cache=outcome;
      return outcome.token;
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return async () => {
    if (cache && Date.now()+60_000 < cache.expiry) return cache.token;
    return pending ??= refresh().finally(()=>{pending=undefined;});
  };
}
