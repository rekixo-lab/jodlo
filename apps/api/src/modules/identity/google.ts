import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from "jose";

/** Fixed official Google OIDC key endpoint; no user-controlled URLs. */
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  timeoutDuration: 3000,
  cooldownDuration: 30000,
  cacheMaxAge: 3600000,
});

export function validGoogleClientId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_-]{10,120}\.apps\.googleusercontent\.com$/.test(value);
}

export const ACCOUNT_ERASURE_NONCE = /^jodlo_erase_[0-9a-f-]{36}$/;

/** Returns ONLY Google's stable subject; never trusts email/name/unsigned payload.
 * Production uses Google's rotating JWKS, tests use locally generated RSA keys.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
  approvedAndroidClientId?: string,
  erasureNonce?: string,
): Promise<string | null> {
  if (!validGoogleClientId(audience) || idToken.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      audience,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      clockTolerance: "5s",
      maxTokenAge: erasureNonce === undefined ? "1h" : "5m",
      requiredClaims: ["sub", "iat", "exp"],
    });
    // jose confirms the audience CONTAINS this client, but OIDC also requires
    // checking additional audiences and the authorized-party (azp) claim.
    // Google's Android -> backend ID token uses the WEB client as audience,
    // but may identify the originating Android OAuth client in `azp`.
    // Only the exact operator-approved Android client is additionally trusted.
    // Never widen the audience to all clients in the Google Cloud project.
    const solelyForClient = payload.aud === audience ||
      (Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === audience);
    const trustedAndroid = validGoogleClientId(approvedAndroidClientId) &&
      approvedAndroidClientId !== audience && payload.azp === approvedAndroidClientId;
    if (!solelyForClient || (payload.azp !== undefined &&
        payload.azp !== audience && !trustedAndroid)) return null;
    if (erasureNonce !== undefined) {
      if (!ACCOUNT_ERASURE_NONCE.test(erasureNonce) || payload.nonce !== erasureNonce) return null;
    } else if (typeof payload.nonce === "string" && ACCOUNT_ERASURE_NONCE.test(payload.nonce)) {
      return null;
    }
    if (typeof payload.sub !== "string" || !/^[0-9]{6,255}$/.test(payload.sub)) return null;
    return payload.sub;
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error; // JWKS network outage: router responds 503 without leaking details.
  }
}
