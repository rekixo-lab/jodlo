import type { Env } from "../data/d1.ts";
import { listPublicCategories, type CatalogLanguage } from "../modules/catalog/catalog.ts";
import { healthData } from "../modules/system/health.ts";
import { optInAsWorker, ownWorkerDraft } from "../modules/workers/profile.ts";

type ApiErrorCode = "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INVALID_QUERY" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED" | "FORBIDDEN";
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

function getOnly(request: Request): Response | null {
  if (request.method === "GET") return null;
  return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: "GET" });
}

/** Closed router; catalog is public, database writes remain inaccessible. */
export async function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/v1/health") {
    return getOnly(request) ?? json({ ok: true, data: healthData() });
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
  if (url.pathname === "/api/v1/me/worker-profile") {
    const allowed = "GET, POST";
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: allowed });
    }
    // Query parameters and client-selected account IDs cannot control ownership.
    if (url.search || (request.method === "POST" && request.body !== null)) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Unexpected input" } }, 400);
    }
    if (!env.DB || !env.AUTH) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Identity unavailable" } }, 503);
    }
    const credential = request.headers.get("Authorization");
    if (!credential || !/^Bearer [^\s]{1,2048}$/.test(credential)) {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    try {
      // AUTH must validate the bearer with an approved provider and resolve an internal account ID.
      const actor = await env.AUTH.verify(credential.slice(7));
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
