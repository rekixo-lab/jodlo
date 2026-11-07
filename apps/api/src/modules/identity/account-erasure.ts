import { errors, jwtVerify, SignJWT } from "jose";
import type { D1Database } from "../../data/d1.ts";
import { ACCOUNT_ERASURE_NONCE, verifyGoogleIdToken } from "./google.ts";
import { findSessionAccount, sessionHash, validSessionToken } from "./sessions.ts";

const CHALLENGE_AUDIENCE = "jodlo-account-erasure";
const CHALLENGE_LIFETIME_SECONDS = 300;

const ERASE_CURRENT_ACCOUNT =
  "DELETE FROM accounts WHERE status='active' AND id=(" +
  "SELECT s.account_id FROM auth_sessions AS s " +
  "JOIN google_identities AS identity ON identity.account_id=s.account_id " +
  "WHERE s.token_hash=? AND s.expires_at>unixepoch() AND identity.google_sub=?) " +
  "AND ?>unixepoch() RETURNING id";

type ErasureChallenge = Readonly<{challenge: string; nonce: string}>;

function erasureSessionBinding(bearer: string): Promise<string> {
  return sessionHash(`jodlo-account-erasure:${bearer}`);
}

/** Create a short-lived, purpose-specific challenge for an already signed-in
 * account. The challenge carries no raw bearer, Google subject or account ID.
 */
export async function prepareAccountErasure(
  db: D1Database, bearer: string, signingKey: Uint8Array,
): Promise<ErasureChallenge | null> {
  if (signingKey.byteLength < 32 || !(await findSessionAccount(db, bearer))) return null;
  const now = Math.floor(Date.now() / 1000);
  const nonce = `jodlo_erase_${crypto.randomUUID()}`;
  const challenge = await new SignJWT()
    .setProtectedHeader({alg: "HS256", typ: "jodlo-account-erasure+jwt"})
    .setAudience(CHALLENGE_AUDIENCE)
    .setSubject(await erasureSessionBinding(bearer))
    .setJti(nonce)
    .setIssuedAt(now)
    .setExpirationTime(now + CHALLENGE_LIFETIME_SECONDS)
    .sign(signingKey);
  return {challenge, nonce};
}

/** Internal D1 erasure only. A caller must first obtain an explicit confirmed
 * erasure request. Deleting the account revokes the session in the same
 * statement via FK cascade, so a replay cannot delete a recreated account.
 * No provider, backup, or device data is modified by this operation.
 */
export async function eraseOwnD1Account(
  db: D1Database, bearer: string, challenge: string, googleProof: string,
  config: Readonly<{signingKey: Uint8Array; googleAudience: string; androidClientId?: string}>,
  verifyGoogle: typeof verifyGoogleIdToken = verifyGoogleIdToken,
): Promise<boolean> {
  if (!validSessionToken(bearer) || config.signingKey.byteLength < 32 ||
      challenge.length > 1024) return false;
  let nonce: string;
  let expiry: number;
  try {
    const {payload} = await jwtVerify(challenge, config.signingKey, {
      algorithms: ["HS256"],
      typ: "jodlo-account-erasure+jwt",
      audience: CHALLENGE_AUDIENCE,
      subject: await erasureSessionBinding(bearer),
      requiredClaims: ["exp", "iat", "jti"],
      maxTokenAge: CHALLENGE_LIFETIME_SECONDS,
    });
    if (typeof payload.jti !== "string" || !ACCOUNT_ERASURE_NONCE.test(payload.jti) ||
        typeof payload.exp !== "number") return false;
    nonce = payload.jti;
    expiry = payload.exp;
  } catch (error) {
    if (error instanceof errors.JOSEError) return false;
    throw error;
  }

  const subject = await verifyGoogle(
    googleProof, config.googleAudience, undefined, config.androidClientId, nonce,
  );
  const now = Math.floor(Date.now() / 1000);
  if (subject === null || expiry <= now) return false;

  const {results} = await db.prepare(ERASE_CURRENT_ACCOUNT)
    .bind(await sessionHash(bearer), subject, expiry).all<{id: string}>();
  return results.length === 1;
}
