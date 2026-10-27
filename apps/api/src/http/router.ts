import { healthData } from "../modules/system/health.ts";

type ApiOk = { ok: true; data: ReturnType<typeof healthData> };
type ApiError = { ok: false; error: { code: "NOT_FOUND" | "METHOD_NOT_ALLOWED"; message: string } };

const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
});

function json(data: ApiOk | ApiError, status = 200, additionalHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...additionalHeaders },
  });
}

/** Deliberately closed router: no accidental unauthenticated data endpoints. */
export function handleRequest(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/v1/health") {
    if (request.method !== "GET") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: "GET" });
    }
    return json({ ok: true, data: healthData() });
  }
  return json({ ok: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404);
}
