import type { Env } from "../data/d1.ts";
import { listPublicCategories, parseCatalogSearch, searchPublicCategories, type CatalogLanguage } from "../modules/catalog/catalog.ts";
import { healthData } from "../modules/system/health.ts";
import { optInAsWorker, ownWorkerDraft } from "../modules/workers/profile.ts";
import { validGoogleClientId, verifyGoogleIdToken } from "../modules/identity/google.ts";
import { resolveGoogleAccount } from "../modules/identity/google-accounts.ts";
import { issueSession, makeSessionVerifier, revokeAllSessions, revokeSession, SESSION_TTL_SECONDS } from "../modules/identity/sessions.ts";
import { readGoogleLoginBody } from "./body.ts";
import {
  allowGoogleAccountLogin, allowLoginBurst,
  LOGIN_BURST_RETRY_SECONDS, ACCOUNT_LOGIN_RETRY_SECONDS,
} from "../modules/identity/admission.ts";

type ApiErrorCode = "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INVALID_QUERY" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED";
type ApiResponse = { ok: true; data: unknown } | { ok: false; error: { code: ApiErrorCode; message: string } };

const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
});

function json(data: ApiResponse, status = 200, additionalHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...additionalHeaders },
  });
}


/** One centralized parser: reject multiple/ambiguous or malformed auth headers. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{1,2048})$/);
  return match?.[1] ?? null;
}

function getOnly(request: Request): Response | null {
  if (request.method === "GET") return null;
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: "GET" });
}

/** Production uses the fixed Google-JWKS verifier; injectable only through direct
 * router unit tests (the deployed Worker entrypoint never supplies a replacement).
 */
export async function handleRequest(
  request: Request, env: Env = {},
  verifyGoogle: typeof verifyGoogleIdToken = verifyGoogleIdToken,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/v1/health") {
    return getOnly(request) ?? json({ ok: true, data: healthData() });
  }
  if (url.pathname === "/api/v1/catalog/search") {
    const methodError = getOnly(request);
    if (methodError) return methodError;
    const options = parseCatalogSearch(url.searchParams);
    if (!options) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Invalid catalog search query" } }, 400);
    }
    if (!env.DB) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } }, 503);
    }
    try {
      const page = await searchPublicCategories(env.DB, options);
      return json({ ok: true, data: { language: options.language, query: options.query, ...page } });
    } catch {
      // Neither SQL errors nor data/credentials are returned to anonymous callers.
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/catalog") {
    const methodError = getOnly(request);
    if (methodError) return methodError;
    const params = url.searchParams;
    const language = params.get("lang") ?? "en";
    let hasUnknownParameter = false;
    params.forEach((_value, key) => { if (key !== "lang") hasUnknownParameter = true; });
    if (hasUnknownParameter ||
        params.getAll("lang").length > 1 ||
        (language !== "en" && language !== "hi")) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Invalid catalog query" } }, 400);
    }
    if (!env.DB) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } }, 503);
    }
    try {
      const categories = await listPublicCategories(env.DB, language as CatalogLanguage);
      return json({ ok: true, data: { language, categories } });
    } catch {
      // Do not expose SQL, binding details, tokens, or database configuration.
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/auth/google") {
    if (request.method !== "POST") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: "POST" });
    }
    if (url.search) return json({ ok: false, error: { code: "INVALID_QUERY", message: "Unexpected query" } }, 400);
    // Fail closed if the owner hasn't configured both Cloudflare admission limits.
    // The normal Wrangler config has no live bindings during development.
    if (!env.DB || !validGoogleClientId(env.GOOGLE_CLIENT_ID) ||
        !env.LOGIN_BURST_LIMITER || !env.ACCOUNT_LOGIN_LIMITER) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Sign-in unavailable" } }, 503);
    }
    const idToken = await readGoogleLoginBody(request);
    if (!idToken) return json({ ok: false, error: { code: "INVALID_QUERY", message: "Invalid sign-in request" } }, 400);
    try {
      // Stage 1: protects expensive signature/JWKS processing from bursts.
      if (!await allowLoginBurst(env.LOGIN_BURST_LIMITER)) {
        return json({ ok: false, error: { code: "RATE_LIMITED", message: "Sign-in temporarily limited" } },
          429, { "Retry-After": String(LOGIN_BURST_RETRY_SECONDS) });
      }
      const subject = await verifyGoogle(idToken, env.GOOGLE_CLIENT_ID);
      if (!subject) return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid sign-in" } }, 401);
      // Stage 2: stops repeat valid Google proofs from overwhelming account/session D1 writes.
      if (!await allowGoogleAccountLogin(env.ACCOUNT_LOGIN_LIMITER, subject)) {
        return json({ ok: false, error: { code: "RATE_LIMITED", message: "Sign-in temporarily limited" } },
          429, { "Retry-After": String(ACCOUNT_LOGIN_RETRY_SECONDS) });
      }
      const accountId = await resolveGoogleAccount(env.DB, subject);
      if (!accountId) return json({ ok: false, error: { code: "FORBIDDEN", message: "Account unavailable" } }, 403);
      const session = await issueSession(env.DB, accountId);
      if (!session) {
        return json({ ok: false, error: { code: "RATE_LIMITED", message: "Active session limit reached" } },
          429, { "Retry-After": String(SESSION_TTL_SECONDS) });
      }
      return json({ ok: true, data: session });
    } catch {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Sign-in unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/auth/logout" || url.pathname === "/api/v1/auth/logout-all") {
    if (request.method !== "POST") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: "POST" });
    }
    if (url.search || request.body !== null) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Unexpected input" } }, 400);
    }
    if (!env.DB) return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Identity unavailable" } }, 503);
    const token = bearerToken(request);
    if (!token) return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    try {
      const allDevices = url.pathname === "/api/v1/auth/logout-all";
      const revoked = allDevices
        ? await revokeAllSessions(env.DB, token)
        : await revokeSession(env.DB, token);
      if (!revoked) return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
      return json({ ok: true, data: { revoked: true, ...(allDevices ? { allDevices: true } : {}) } });
    } catch {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Identity unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/me/worker-profile") {
    const allowed = "GET, POST";
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: allowed });
    }
    // Query parameters and client-selected account IDs cannot control ownership.
    if (url.search || (request.method === "POST" && request.body !== null)) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Unexpected input" } }, 400);
    }
    if (!env.DB) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Identity unavailable" } }, 503);
    }
    const token = bearerToken(request);
    if (!token) {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    try {
      // Production resolves server-issued revocable sessions; old AUTH seam is only a trusted fake in tests.
      const actor = await (env.AUTH ?? makeSessionVerifier(env.DB)).verify(token);
      if (!actor || !/^[-_a-zA-Z0-9]{8,128}$/.test(actor.accountId)) {
        return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
      }
      const profile = request.method === "POST"
        ? await optInAsWorker(env.DB, actor.accountId)
        : await ownWorkerDraft(env.DB, actor.accountId);
      if (!profile) {
        return request.method === "POST"
          ? json({ ok: false, error: { code: "FORBIDDEN", message: "Account unavailable" } }, 403)
          : json({ ok: false, error: { code: "NOT_FOUND", message: "Profile not found" } }, 404);
      }
      return json({ ok: true, data: { profile } });
    } catch {
      // Fail closed; never reflect SQL errors or credential/provider details.
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Identity unavailable" } }, 503);
    }
  }
  return json({ ok: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404);
}
