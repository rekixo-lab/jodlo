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

/** Returns ONLY Google's stable subject; never trusts email/name/unsigned payload.
 * Production uses Google's rotating JWKS, tests use locally generated RSA keys.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audience: string,
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
): Promise<string | null> {
  if (!validGoogleClientId(audience) || idToken.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      audience,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      clockTolerance: "5s",
      maxTokenAge: "1h",
      requiredClaims: ["sub", "iat", "exp"],
    });
    if (typeof payload.sub !== "string" || !/^[0-9]{6,255}$/.test(payload.sub)) return null;
    return payload.sub;
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error; // JWKS network outage: router responds 503 without leaking details.
  }
}
