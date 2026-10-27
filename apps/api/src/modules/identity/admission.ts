import type { RateLimitBinding } from "../../data/d1.ts";
import { sessionHash } from "./sessions.ts";

/** Pre-verification coarse gate uses one shared key, not IP or caller headers.
 * It protects Google JWKS verification from bursts but may throttle legitimate
 * traffic in the same Cloudflare PoP. Require owner review/monitoring before launch.
 */
export const LOGIN_BURST_RETRY_SECONDS = 10;
export const ACCOUNT_LOGIN_RETRY_SECONDS = 60;
const PUBLIC_GOOGLE_LOGIN_KEY = "google:login:unverified";

/** Cloudflare counters are best effort per location, not globally strict. */
async function allowed(binding: RateLimitBinding, key: string): Promise<boolean> {
  const result = await binding.limit({ key });
  if (typeof result?.success !== "boolean") throw new Error("Invalid rate-limit result");
  return result.success;
}

export async function allowLoginBurst(binding: RateLimitBinding): Promise<boolean> {
  return allowed(binding, PUBLIC_GOOGLE_LOGIN_KEY);
}

/** Hashed stable verified subject avoids passing raw Google sub to limiter keys.
 * No extra durable account tables or client-provided IP/identity.
 */
export async function allowGoogleAccountLogin(
  binding: RateLimitBinding, verifiedGoogleSub: string,
): Promise<boolean> {
  return allowed(binding, "google:verified:" + await sessionHash(verifiedGoogleSub));
}
