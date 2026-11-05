import type { Env } from "../data/d1.ts";
import { validOpaqueId } from "../modules/shared/identifiers.ts";
import { browsePublicCategories, parseCatalogBrowse, parseCatalogSearch, searchPublicCategories, parsePublicCategoryLabels, resolveApprovedCategoryLabels } from "../modules/catalog/catalog.ts";
import { healthData } from "../modules/system/health.ts";
import { optInAsWorker, ownWorkerDraft } from "../modules/workers/profile.ts";
import { ownAccountOverview, exportOwnAccountData } from "../modules/identity/account-self-service.ts";
import { validGoogleClientId, verifyGoogleIdToken } from "../modules/identity/google.ts";
import { resolveGoogleAccount } from "../modules/identity/google-accounts.ts";
import { issueSession, makeSessionVerifier, revokeAllSessions, revokeSession, SESSION_TTL_SECONDS } from "../modules/identity/sessions.ts";
import { hasEmptyBody, readGoogleLoginBody, readServiceListingBody, readCategoryEditBody, readResumeOwnListingBody } from "./body.ts";
import { validCategoryId } from "../modules/shared/identifiers.ts";
import { publishListing, myListings, pageMyListings, pageManagedOwnListings, parseOwnListingsPage, publicListings, pagePublicListings, publicListingDetail, publicApprovedServiceDetail, pageAllPublicListings, unpublishListing, editOwnListingCategory, resumeOwnListing } from "../modules/workers/listings.ts";
import {
  allowGoogleAccountLogin, allowLoginBurst,
  LOGIN_BURST_RETRY_SECONDS, ACCOUNT_LOGIN_RETRY_SECONDS,
} from "../modules/identity/admission.ts";

type ApiErrorCode = "CONFLICT" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INVALID_QUERY" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED";
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
    if (url.searchParams.has("ids")) {
      // Exact, anonymous, explicit label lookup. Unapproved or disabled
      // Category IDs are omitted: no hidden name or worker data is leaked.
      const labels=parsePublicCategoryLabels(url.searchParams);
      if(!labels) return json({ok:false,error:{
        code:"INVALID_QUERY",message:"Invalid catalog label lookup"}},400);
      if(!env.DB) return json({ok:false,error:{
        code:"SERVICE_UNAVAILABLE",message:"Catalog unavailable"}},503);
      try {
        const categories=await resolveApprovedCategoryLabels(env.DB,labels);
        return json({ok:true,data:{
          language:labels.language,categories,nextCursor:null}});
      } catch {
        return json({ok:false,error:{
          code:"SERVICE_UNAVAILABLE",message:"Catalog unavailable"}},503);
      }
    }
    const options = parseCatalogBrowse(url.searchParams);
    if (!options) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Invalid catalog query" } }, 400);
    }
    if (!env.DB) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } }, 503);
    }
    try {
      const page = await browsePublicCategories(env.DB, options);
      // Only paged clients see nextCursor; preserve the legacy unpaginated DTO.
      const data = options.limit === null
        ? { language:options.language,categories:page.categories }
        : { language:options.language,...page };
      return json({ ok: true, data });
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
      // Web audience is always required. Only the owner's explicitly configured
      // Android OAuth client may additionally appear as the signed `azp` claim.
      const subject = await verifyGoogle(idToken, env.GOOGLE_CLIENT_ID, undefined,
        env.GOOGLE_ANDROID_CLIENT_ID);
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
    if (url.search || !(await hasEmptyBody(request))) {
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

  // The Finworkar account/dashboard behavior is reconstructed with JODLO's
  // own active-account D1 records. Both routes are private, read-only and
  // require a current server-issued session; neither accepts a client owner ID.
  if (url.pathname === "/api/v1/me/overview" ||
      url.pathname === "/api/v1/me/data-export") {
    const methodError = getOnly(request);
    if (methodError) return methodError;
    if (url.search || !(await hasEmptyBody(request))) {
      return json({ ok: false, error: { code: "INVALID_QUERY", message: "Unexpected input" } }, 400);
    }
    if (!env.DB) {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Account unavailable" } }, 503);
    }
    const token = bearerToken(request);
    if (!token) {
      return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    try {
      const actor = await (env.AUTH ?? makeSessionVerifier(env.DB)).verify(token);
      if (!actor || !validOpaqueId(actor.accountId)) {
        return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
      }
      const data = url.pathname.endsWith("/overview")
        ? await ownAccountOverview(env.DB, actor.accountId)
        : await exportOwnAccountData(env.DB, actor.accountId);
      if (!data) {
        return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
      }
      return json({ ok: true, data });
    } catch {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Account unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/me/worker-profile") {
    const allowed = "GET, POST";
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405, { Allow: allowed });
    }
    // Query parameters and client-selected account IDs cannot control ownership.
    if (url.search || (request.method === "POST" && !(await hasEmptyBody(request)))) {
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
      if (!actor || !validOpaqueId(actor.accountId)) {
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
  if (url.pathname === "/api/v1/listings") {
    const methodError=getOnly(request);
    if(methodError)return methodError;
    const params=url.searchParams;
    // Opt-in fresh public detail on the EXISTING founder-reviewed listings
    // route. Exactly one opaque id; no extra params, body or private metadata.
    if(params.has("id")) {
      const id=params.get("id");
      // Legacy GET ?id=<id> remains exactly its two-field Listing response.
      // The approved Category detail is STRICTLY opt-in, with one requested
      // language and no caller-supplied owner/category/status or extra keys.
      const view=params.get("view"),lang=params.get("lang");
      const approvedDetail=view==="service" &&
        (lang==="hi"||lang==="en") &&
        params.size===3 && params.getAll("view").length===1 &&
        params.getAll("lang").length===1;
      if(params.getAll("id").length!==1||!validOpaqueId(id)||
          !(view===null&&lang===null&&params.size===1 || approvedDetail)||
          !(await hasEmptyBody(request))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing detail request"}},400);
      }
      if(!env.DB)return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
      try {
        if(approvedDetail){
          const detail=await publicApprovedServiceDetail(env.DB,id!,lang as "hi"|"en");
          if(!detail)return json({ok:false,error:{code:"NOT_FOUND",message:"Listing not found"}},404);
          return json({ok:true,data:detail});
        }
        const listing=await publicListingDetail(env.DB,id!);
        if(!listing)return json({ok:false,error:{code:"NOT_FOUND",message:"Listing not found"}},404);
        return json({ok:true,data:{listing}});
      }catch{
        return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
      }
    }
    // Explicit anonymous cross-category feed. NO change to the legacy
    // required-Category endpoint, and no private worker/profile projections.
    // Only one exact mode/limit and one optional CURRENT public cursor.
    if(params.has("feed")) {
      const limit=params.get("limit"),after=params.get("after");
      const allowed=new Set(["feed","limit","after"]);
      let invalid=params.get("feed")!=="all" ||
        params.getAll("feed").length!==1 || params.getAll("limit").length!==1 ||
        limit===null || !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(limit) ||
        (after!==null&&!validOpaqueId(after));
      params.forEach((_v,key)=>{
        if(!allowed.has(key)||params.getAll(key).length!==1)invalid=true;
      });
      if(invalid || !(await hasEmptyBody(request)))
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid public feed query"}},400);
      if(!env.DB)return json({ok:false,error:{
        code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
      try {
        return json({ok:true,data:await pageAllPublicListings(env.DB,Number(limit),after)});
      } catch {
        return json({ok:false,error:{
          code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
      }
    }
    const categoryId=params.get("categoryId");
    const rawLimit=params.get("limit");
    const after=params.get("after");
    let invalid=false;
    const allowed=new Set(["categoryId","limit","after"]);
    params.forEach((_v,key)=>{
      if(!allowed.has(key)||params.getAll(key).length!==1)invalid=true;
    });
    if(invalid||params.getAll("categoryId").length!==1||!validCategoryId(categoryId)||
        (rawLimit===null && after!==null)||
        (rawLimit!==null&&!/^(?:[1-9]|1[0-9]|2[0-5])$/.test(rawLimit))||
        (after!==null && !validOpaqueId(after))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid category query"}},400);
    }
    if(!env.DB)return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
    try {
      if(rawLimit!==null) {
        // Explicit paging is opt-in; never change the legacy unpaged DTO.
        const page=await pagePublicListings(env.DB,categoryId!,Number(rawLimit),after);
        return json({ok:true,data:page});
      }
      const listings=await publicListings(env.DB,categoryId!);
      return json({ok:true,data:{listings}});
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/listings") {
    if(!["GET","POST","PUT","DELETE"].includes(request.method)) {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, POST, PUT, DELETE"});
    }
    if(!env.DB)return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
    const token=bearerToken(request);
    if(!token)return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    try {
      const actor=await (env.AUTH??makeSessionVerifier(env.DB)).verify(token);
      if(!actor||!validOpaqueId(actor.accountId)) {
        return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
      }
      if(request.method==="GET") {
        const page=parseOwnListingsPage(url.searchParams);
        if(!page||!(await hasEmptyBody(request)))
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
        // No query parameters means the exact legacy owner response (100 cap).
        // Only an explicit limit enables bounded pages across all approved
        // worker Categories; no implicit prefetch or personal-data projection.
        const data=page.limit===null
          ? {listings:await myListings(env.DB,actor.accountId)}
          : page.management
            ? await pageManagedOwnListings(env.DB,actor.accountId,page.limit,page.after)
            : await pageMyListings(env.DB,actor.accountId,page.limit,page.after);
        return json({ok:true,data});
      }
      if(request.method==="POST") {
        // Opt-in reactivation ONLY of a specific previously unpublished own
        // Listing. Unlike regular Publish, never INSERT/UPSERT or create a
        // second row; existing moderation and current approval still apply.
        if(url.search) {
          if(url.searchParams.size!==1||
              url.searchParams.getAll("resume").length!==1||
              url.searchParams.get("resume")!=="1")
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Unexpected query"}},400);
          const input=await readResumeOwnListingBody(request);
          if(!input||!validOpaqueId(input.listingId)||
              !validCategoryId(input.expectedCategoryId))
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Invalid resume input"}},400);
          const listing=await resumeOwnListing(env.DB,actor.accountId,
            input.listingId,input.expectedCategoryId);
          if(!listing)return json({ok:false,error:{
            code:"CONFLICT",message:"Listing changed or unavailable"}},409);
          return json({ok:true,data:{listing}});
        }
        const categoryId=await readServiceListingBody(request);
        if(!validCategoryId(categoryId))
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing input"}},400);
        const listing=await publishListing(env.DB,actor.accountId,categoryId);
        if(!listing)return json({ok:false,error:{code:"FORBIDDEN",message:"Listing not eligible"}},403);
        return json({ok:true,data:{listing}});
      }
      if(request.method==="PUT") {
        // Category-only edit: no new private fields or client-supplied actor.
        // Current worker+account, approved active destination, unique owner
        // category, moderation and expected previous Category are checked in
        // ONE atomic D1 UPDATE. A stale/foreign/duplicate row is one conflict.
        if(url.search) return json({ok:false,error:{
          code:"INVALID_QUERY",message:"Unexpected query"}},400);
        const edit=await readCategoryEditBody(request);
        if(!edit||!validOpaqueId(edit.listingId)||
            !validCategoryId(edit.expectedCategoryId)||
            !validCategoryId(edit.nextCategoryId)||
            edit.expectedCategoryId===edit.nextCategoryId) {
          return json({ok:false,error:{
            code:"INVALID_QUERY",message:"Invalid listing edit"}},400);
        }
        const listing=await editOwnListingCategory(
          env.DB,actor.accountId,edit.listingId,
          edit.expectedCategoryId,edit.nextCategoryId);
        if(!listing) return json({ok:false,error:{
          code:"CONFLICT",message:"Listing changed or unavailable"}},409);
        return json({ok:true,data:{listing}});
      }
      if(!(await hasEmptyBody(request))||url.searchParams.size!==1||
          url.searchParams.getAll("id").length!==1||
          !validOpaqueId(url.searchParams.get("id"))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing ID"}},400);
      }
      const changed=await unpublishListing(env.DB,actor.accountId,url.searchParams.get("id")!);
      if(!changed)return json({ok:false,error:{code:"NOT_FOUND",message:"Listing not found"}},404);
      return json({ok:true,data:{unpublished:true}});
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
    }
  }
  return json({ ok: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404);
}
