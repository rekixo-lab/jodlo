import { readOwnWorkerAvailability, setOwnWorkerAvailability } from "../modules/interactions/agora-private-safety-state.ts";
import { handleConfiguredJodloPlayRtdn } from "../modules/interactions/google-play-pubsub-handler.ts";
import { issueOwnAgoraAudioGrant } from "../modules/interactions/private-agora-media.ts";
import { validIdempotencyKey } from "../modules/shared/identifiers.ts";
import { ownPrivateCallSignal, validCallAction } from "../modules/interactions/private-call-signaling.ts";
import { preparePrivateCallInvitation } from "../modules/interactions/private-call-invitation.ts";
import { sendPrivateCallRing } from "../modules/interactions/private-call-ring.ts";
import { createFcmAccessTokenSource } from "../modules/notifications/fcm-oauth.ts";
import { readRegisteredCallDestination, registerOwnCallDevice, removeOwnCallDevice } from "../modules/notifications/private-call-devices.ts";
import { validFcmRegistrationToken } from "../modules/notifications/fcm-provider.ts";
import type { Env } from "../data/d1.ts";
import { validOpaqueId } from "../modules/shared/identifiers.ts";
import { browsePublicCategories, parseCatalogBrowse, parseCatalogSearch, searchPublicCategories, parsePublicCategoryLabels, resolveApprovedCategoryLabels } from "../modules/catalog/catalog.ts";
import { healthData } from "../modules/system/health.ts";
import { parseHierarchy, readApprovedHierarchy } from "../modules/catalog/hierarchy.ts";
import { clearServicePhoto, ownServicePhoto, pendingServicePhotos, publicServicePhoto, reviewServicePhoto, servicePhotoForReview, submitServicePhoto, validServicePhoto } from "../modules/workers/service-photos.ts";
import { clearOwnServiceDetails, parseServiceDetails, pendingServiceDetails, readOwnServiceDetails, reviewServiceDetails, submitOwnServiceDetails } from "../modules/workers/service-details.ts";
import { appealServiceCase, decideServiceCase, ownReportStatus, ownServiceAppealCase, reportService, serviceCaseEvidence, serviceCaseQueue, validAppealReason, validCaseDecision, validReportReason } from "../modules/moderation/service-cases.ts";
import { changeOwnServiceArea, readOwnServiceArea, validServiceCity } from "../modules/workers/service-area.ts";
import { optInAsWorker, ownWorkerDraft } from "../modules/workers/profile.ts";
import { readOwnWorkerAgoraCallPreference, setOwnWorkerAgoraCallPreference } from "../modules/workers/agora-call-preference.ts";
import { clearOwnCallHistory, readOwnCallHistory } from "../modules/interactions/call-history.ts";
import { readOwnAgoraListingBlock, changeOwnAgoraListingBlock, readOwnContactBlocks, removeOwnContactBlock, validBlockManagementId } from "../modules/interactions/agora-listing-blocks.ts";
import { prepareAccountErasure, eraseOwnD1Account } from "../modules/identity/account-erasure.ts";
import { ownAccountOverview, exportOwnAccountData } from "../modules/identity/account-self-service.ts";
import { validGoogleClientId, verifyGoogleIdToken } from "../modules/identity/google.ts";
import { resolveGoogleAccount } from "../modules/identity/google-accounts.ts";
import { issueSession, makeSessionVerifier, validSessionToken, revokeAllSessions, revokeSession, SESSION_TTL_SECONDS } from "../modules/identity/sessions.ts";
import { readCallDeviceBody, hasEmptyBody, readGoogleLoginBody, readServiceListingBody, readCategoryEditBody, readVersionedCategoryEditBody, readResumeOwnListingBody, readPublicationRevisionBody, readAccountErasureBody, readServiceCityBody, readServiceDetailsBody, readServicePhotoBody, readServiceCaseReason } from "./body.ts";
import { validCategoryId } from "../modules/shared/identifiers.ts";
import { publishListing, myListings, pageMyListings, pageManagedOwnListings, exactManagedOwnListing, exactManagedOwnListingByCategory, exactVersionedOwnListing, parseOwnListingsPage, publicListings, pagePublicListings, publicListingDetail, publicApprovedServiceDetail, pageAllPublicListings, unpublishListing, editOwnListingCategory, editOwnListingCategoryVersioned, resumeOwnListing, changeOwnListingPublication, createOwnListing } from "../modules/workers/listings.ts";
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

/** Moderation key is a separate server-only credential, never a JODLO bearer. */
function authorizedServiceModerator(token: string | null, key: string | undefined): boolean {
  if (!key || !/^[a-f0-9]{64}$/.test(key) || !token || !/^[a-f0-9]{64}$/.test(token)) return false;
  let difference = 0;
  for (let i = 0; i < key.length; i++) difference |= key.charCodeAt(i) ^ token.charCodeAt(i);
  return difference === 0;
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
  if (url.pathname === "/api/v1/play/rtdn" && env.PLAY_RTDN_ENABLED === "1") {
    // Default OFF. Only Google-signed Pub/Sub push plus a second live
    // AndroidPublisher check can fence a purchase; this route never grants.
    return handleConfiguredJodloPlayRtdn(request, env);
  }
  if (url.pathname === "/api/v1/health") {
    return getOnly(request) ?? json({ ok: true, data: healthData() });
  }
  if (url.pathname === "/api/v1/catalog/hierarchy") {
    // Strict opt-in hierarchy, no migration seeding and no new public fields.
    const methodError=getOnly(request);
    if(methodError)return methodError;
    const options=parseHierarchy(url.searchParams);
    if(!options)return json({ok:false,error:{
      code:"INVALID_QUERY",message:"Invalid hierarchy query"}},400);
    if(!env.DB)return json({ok:false,error:{
      code:"SERVICE_UNAVAILABLE",message:"Catalog unavailable"}},503);
    try {
      const page=await readApprovedHierarchy(env.DB,options);
      return json({ok:true,data:page});
    }catch {
      // Older un-migrated D1 or any SQL error must not reveal internals.
      return json({ok:false,error:{
        code:"SERVICE_UNAVAILABLE",message:"Catalog unavailable"}},503);
    }
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

  if (url.pathname === "/api/v1/me/call-media" && env.CALL_SIGNALING_ENABLED === "1" &&
      env.CALL_MEDIA_VERIFICATION_ENABLED === "1") {
    if (request.method !== "POST") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,{Allow:"POST"});
    }
    const bearer = bearerToken(request);
    if (!validSessionToken(bearer)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    const id = url.searchParams.get("id");
    if (!validOpaqueId(id) || url.searchParams.size !== 1 || !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid call input"}},400);
    }
    try {
      if (!env.DB || !env.AGORA_APP_CERTIFICATE) throw new Error("Missing media setup");
      const grant = await issueOwnAgoraAudioGrant(env.DB, bearer, id, env.AGORA_APP_CERTIFICATE);
      if (grant) return json({ok:true,data:grant});
      return json({ok:false,error:{code:"NOT_FOUND",message:"Call unavailable"}},404);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call unavailable"}},503);
    }
  }

  if (env.CALL_SIGNALING_ENABLED === "1" &&
      (url.pathname === "/api/v1/me/call" || url.pathname === "/api/v1/me/call-invitation")) {
    const starting = url.pathname.endsWith("/call-invitation");
    const allow = starting ? "POST" : "GET, PUT";
    if (starting ? request.method !== "POST" : !["GET", "PUT"].includes(request.method)) {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,{Allow:allow});
    }
    const bearer = bearerToken(request);
    if (!validSessionToken(bearer)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    const id = url.searchParams.get(starting ? "listingId" : "id");
    const attemptKey = request.headers.get("Idempotency-Key");
    const action = request.method === "PUT" ? url.searchParams.get("action") : undefined;
    if (!validOpaqueId(id) || url.searchParams.size !== (request.method === "PUT" ? 2 : 1) ||
        (starting && !validIdempotencyKey(attemptKey)) ||
        (request.method === "PUT" && !validCallAction(action)) || !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid call input"}},400);
    }
    try {
      const db = env.DB;
      if (!db) throw new Error("Missing call storage");
      if (starting && validIdempotencyKey(attemptKey)) {
        const {FCM_PROJECT_ID:projectId, FCM_SERVICE_ACCOUNT_EMAIL:email,
          FCM_SERVICE_ACCOUNT_PRIVATE_KEY:privateKey} = env;
        if (!projectId || !email || !privateKey || env.CALL_DEVICES_ENABLED !== "1") {
          throw new Error("Missing call provider configuration");
        }
        const accessToken = createFcmAccessTokenSource({email,privateKey});
        const invitation = await preparePrivateCallInvitation(db, bearer, id, attemptKey);
        if (invitation.kind !== "denied") {
          const delivery = await sendPrivateCallRing(db, bearer, invitation.invitationId, {
            projectId, accessToken,
            resolveReachableDevice: accountId => readRegisteredCallDestination(db, accountId),
          });
          if (invitation.kind === "created" && delivery === "not_sent") {
            await ownPrivateCallSignal(db, bearer, invitation.invitationId, "cancel");
            return json({ok:false,error:{code:"NOT_FOUND",message:"Call unavailable"}},404);
          }
          return json({ok:true,data:{id:invitation.invitationId,ringDeadlineMs:invitation.ringDeadlineMs}});
        }
      } else {
        const signal = await ownPrivateCallSignal(db, bearer, id, validCallAction(action) ? action : undefined);
        if (signal) return json({ok:true,data:signal});
      }
      return json({ok:false,error:{code:"NOT_FOUND",message:"Call unavailable"}},404);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call unavailable"}},503);
    }
  }

  if (url.pathname === "/api/v1/me/call-device" && env.CALL_DEVICES_ENABLED === "1") {
    if (request.method !== "PUT" && request.method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,{Allow:"PUT, DELETE"});
    }
    const bearer = bearerToken(request);
    if (!validSessionToken(bearer)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    const registrationToken = request.method === "PUT" ? await readCallDeviceBody(request) : null;
    if (url.searchParams.size || (request.method === "PUT"
      ? !validFcmRegistrationToken(registrationToken)
      : !(await hasEmptyBody(request)))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid call device input"}},400);
    }
    try {
      if (!env.DB) throw new Error("Missing device storage");
      if (!(await makeSessionVerifier(env.DB).verify(bearer))) {
        return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
      }
      if (registrationToken === null) {
        await removeOwnCallDevice(env.DB, bearer);
        return json({ok:true,data:{registered:false}});
      }
      if (!(await registerOwnCallDevice(env.DB, bearer, registrationToken))) {
        return json({ok:false,error:{code:"FORBIDDEN",message:"Call device registration unavailable"}},403);
      }
      return json({ok:true,data:{registered:true}});
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call device unavailable"}},503);
    }
  }

  // The Finworkar account/dashboard behavior is reconstructed with JODLO's
  // own active-account D1 records. Both routes are private, read-only and
  // require a current server-issued session; neither accepts a client owner ID.
  if (url.pathname === "/api/v1/me/call-history") {
    if (env.CALL_HISTORY_ENABLED !== "1") {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    if (request.method !== "GET" && request.method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, DELETE"});
    }
    const after = url.searchParams.get("after");
    if ((request.method === "DELETE" && url.searchParams.size !== 0) ||
        (request.method === "GET" && url.searchParams.size !== 0 &&
          (url.searchParams.size !== 1 || !validOpaqueId(after))) ||
        !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid call history input"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call history unavailable"}},503);
    }
    try {
      if (request.method === "DELETE") {
        if (!(await makeSessionVerifier(env.DB).verify(token))) {
          return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
        }
        const cleared = await clearOwnCallHistory(env.DB, token);
        return cleared ? json({ok:true,data:{cleared:true}})
          : json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
      }
      const history = await readOwnCallHistory(env.DB, token, after);
      return history ? json({ok:true,data:history})
        : json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call history unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/contact-blocks") {
    if (env.CONTACT_BLOCKS_ENABLED !== "1") {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    const method = request.method;
    if (method !== "GET" && method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, DELETE"});
    }
    const params = url.searchParams;
    const id = params.get("id");
    const after = params.get("after");
    const language = params.get("lang");
    const validQuery = method === "GET"
      ? (language === "en" || language === "hi") && params.size === (after === null ? 1 : 2)
        && (after === null || validBlockManagementId(after))
      : params.size === 1 && validBlockManagementId(id);
    if (!validQuery || !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid contact block input"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Contact safety unavailable"}},503);
    }
    try {
      if (method === "GET") {
        const page = await readOwnContactBlocks(env.DB, token, after ?? "", language === "hi" ? "hi" : "en");
        return page ? json({ok:true,data:page})
          : json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
      }
      const removed = await removeOwnContactBlock(env.DB, token, id!);
      return removed ? json({ok:true,data:{blocked:false}})
        : json({ok:false,error:{code:"NOT_FOUND",message:"Contact block unavailable"}},404);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Contact safety unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/contact-block") {
    if (env.CONTACT_BLOCKS_ENABLED !== "1") {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    const method = request.method;
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, POST, DELETE"});
    }
    const listingId = url.searchParams.get("listingId");
    if (url.searchParams.size !== 1 || !validOpaqueId(listingId) || !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing input"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Contact safety unavailable"}},503);
    try {
      if (method === "GET") {
        const blocked = await readOwnAgoraListingBlock(env.DB, token, listingId);
        return blocked === null
          ? json({ok:false,error:{code:"NOT_FOUND",message:"Listing unavailable"}},404)
          : json({ok:true,data:{blocked}});
      }
      const blocked = method === "POST";
      const changed = await changeOwnAgoraListingBlock(env.DB, token, listingId, blocked);
      return changed ? json({ok:true,data:{blocked}})
        : json({ok:false,error:{code:"CONFLICT",message:"Contact block changed or unavailable"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Contact safety unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/account-erasure") {
    const key = env.ACCOUNT_ERASURE_RELEASE_KEY;
    const audience = env.GOOGLE_CLIENT_ID;
    if (!key || !/^[a-fA-F0-9]{64}$/.test(key) || !validGoogleClientId(audience)) {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    if (request.method !== "POST" && request.method !== "PUT") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"POST, PUT"});
    }
    if (url.search) return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
    const token = bearerToken(request);
    if (!token) return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Account unavailable"}},503);
    const signingKey = Uint8Array.from(key.match(/../g)!, byte => Number.parseInt(byte, 16));
    try {
      if (request.method === "POST") {
        if (!(await hasEmptyBody(request))) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
        }
        const data = await prepareAccountErasure(env.DB, token, signingKey);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
      }
      const input = await readAccountErasureBody(request);
      if (!input) return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid confirmation"}},400);
      const erased = await eraseOwnD1Account(env.DB, token, input.challenge, input.googleProof, {
        signingKey, googleAudience: audience, androidClientId: env.GOOGLE_ANDROID_CLIENT_ID,
      }, verifyGoogle);
      return erased ? json({ok:true,data:{erased:true}})
        : json({ok:false,error:{code:"CONFLICT",message:"Account erasure could not be confirmed"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Account unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/overview" ||
      url.pathname === "/api/v1/me/data-export") {
    const methodError = getOnly(request);
    if (methodError) return methodError;
    const requestedVersion = url.searchParams.get("version");
    const version = url.pathname.endsWith("/data-export") && url.searchParams.size === 1 &&
      (requestedVersion === "2" || requestedVersion === "3") ? Number(requestedVersion) : 1;
    if ((url.search && version === 1) || !(await hasEmptyBody(request))) {
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
      const data = url.pathname.endsWith("/overview")
        ? await ownAccountOverview(env.DB, token)
        : await exportOwnAccountData(env.DB, token, version);
      if (!data) {
        return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
      }
      return json({ ok: true, data });
    } catch {
      return json({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Account unavailable" } }, 503);
    }
  }
  if (url.pathname === "/api/v1/me/service-report" ||
      url.pathname === "/api/v1/me/service-appeal") {
    if (!/^[a-f0-9]{64}$/.test(env.SERVICE_MODERATION_KEY ?? "")) {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Case unavailable"}},503);
    const appeal = url.pathname.endsWith("/service-appeal");
    const params = url.searchParams;
    try {
      if (request.method === "GET") {
        const listingId = params.get("listingId");
        if (params.size !== 1 || !validOpaqueId(listingId) || !(await hasEmptyBody(request))) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing input"}},400);
        }
        const data = appeal
          ? await ownServiceAppealCase(env.DB, token, listingId)
          : await ownReportStatus(env.DB, token, listingId);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"NOT_FOUND",message:"Case unavailable"}},404);
      }
      if (request.method !== "POST") {
        return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
          {Allow:"GET, POST"});
      }
      const reason = await readServiceCaseReason(request);
      if (appeal) {
        const id = params.get("id"), revision = params.get("revision");
        if (params.size !== 2 || !validOpaqueId(id) || revision === null ||
            !/^[1-9][0-9]{0,9}$/.test(revision) || !validAppealReason(reason)) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid appeal"}},400);
        }
        const data = await appealServiceCase(env.DB, token, id, Number(revision), reason);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"CONFLICT",message:"Case changed or unavailable"}},409);
      }
      const listingId = params.get("listingId");
      if (params.size !== 1 || !validOpaqueId(listingId) || !validReportReason(reason)) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid report"}},400);
      }
      const data = await reportService(env.DB, token, listingId, reason);
      return data ? json({ok:true,data},201)
        : json({ok:false,error:{code:"CONFLICT",message:"Report already exists or is unavailable"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Case unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/moderation/service-cases") {
    if (!authorizedServiceModerator(bearerToken(request), env.SERVICE_MODERATION_KEY)) {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Review unavailable"}},503);
    const params = url.searchParams;
    if (!(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
    }
    try {
      if (request.method === "GET") {
        const id = params.get("id");
        if (validOpaqueId(id) && (params.size === 1 || params.size === 2 && params.get("photo") === "1") &&
            params.getAll("id").length === 1) {
          const data = await serviceCaseEvidence(env.DB, id, params.has("photo"));
          return data ? json({ok:true,data})
            : json({ok:false,error:{code:"NOT_FOUND",message:"Case evidence unavailable"}},404);
        }
        const queue = params.get("queue"), after = params.get("after");
        if ((queue !== "pending" && queue !== "appealed") ||
            !(after === null ? params.size === 1 : params.size === 2 && validOpaqueId(after))) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid review page"}},400);
        }
        return json({ok:true,data:await serviceCaseQueue(env.DB, queue, after)});
      }
      if (request.method !== "PUT") {
        return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
          {Allow:"GET, PUT"});
      }
      const id = params.get("id"), revision = params.get("revision"), decision = params.get("decision");
      if (!validOpaqueId(id) || revision === null || !/^[1-9][0-9]{0,9}$/.test(revision) ||
          !validCaseDecision(decision)) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid review decision"}},400);
      }
      const evidenceFields = ["listingRevision", "profileRevision", "photoRevision"]
        .map(name => params.get(name));
      const needsEvidence = decision === "upheld" || decision === "restored";
      if (needsEvidence ? params.size !== 6 ||
          evidenceFields.some(value => value === null || !/^(?:0|[1-9][0-9]{0,9})$/.test(value))
          : params.size !== 3) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid evidence revisions"}},400);
      }
      const [listing, profile, photo] = evidenceFields.map(Number);
      const updated = await decideServiceCase(env.DB, id, Number(revision), decision,
        needsEvidence ? {listing, profile, photo} : null);
      return updated ? json({ok:true,data:{status:decision}})
        : json({ok:false,error:{code:"CONFLICT",message:"Review no longer current"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Review unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/moderation/service-details" ||
      url.pathname === "/api/v1/moderation/service-photo") {
    const photo = url.pathname.endsWith("/service-photo");
    if (!authorizedServiceModerator(bearerToken(request), env.SERVICE_MODERATION_KEY)) {
      return json({ok:false,error:{code:"NOT_FOUND",message:"Endpoint not found"}},404);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Review unavailable"}},503);
    const params = url.searchParams;
    try {
      if (request.method === "GET") {
        const id = params.get("id");
        if (photo && validOpaqueId(id) && params.size === 1 && await hasEmptyBody(request)) {
          const item = await servicePhotoForReview(env.DB, id);
          return item ? json({ok:true,data:item})
            : json({ok:false,error:{code:"NOT_FOUND",message:"Photo unavailable"}},404);
        }
        const after = params.get("after");
        if (!(params.size === 0 || params.size === 1 && validOpaqueId(after)) ||
            !(await hasEmptyBody(request))) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid review page"}},400);
        }
        return json({ok:true,data:photo
          ? await pendingServicePhotos(env.DB, after)
          : await pendingServiceDetails(env.DB, after)});
      }
      if (request.method !== "PUT") {
        return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
          {Allow:"GET, PUT"});
      }
      const id = params.get("id"), revision = params.get("revision"), decision = params.get("decision");
      if (params.size !== 3 || !validOpaqueId(id) || revision === null ||
          !/^[1-9][0-9]{0,9}$/.test(revision) || (decision !== "approved" && decision !== "rejected") ||
          !(await hasEmptyBody(request))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid review decision"}},400);
      }
      const updated = photo
        ? await reviewServicePhoto(env.DB, id, Number(revision), decision)
        : await reviewServiceDetails(env.DB, id, Number(revision), decision);
      return updated ? json({ok:true,data:{status:decision}})
        : json({ok:false,error:{code:"CONFLICT",message:"Review no longer current"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Review unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/service-photo") {
    const method = request.method;
    if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, PUT, DELETE"});
    }
    const params = url.searchParams;
    const id = params.get("id"), revision = params.get("revision");
    const download = params.get("download") === "1";
    if (!validOpaqueId(id) || params.getAll("id").length !== 1 ||
        (method === "GET" ? params.size !== (download ? 2 : 1) :
          params.size !== 2 || revision === null || !/^(?:0|[1-9][0-9]{0,9})$/.test(revision))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service photo query"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service photo unavailable"}},503);
    try {
      if (method !== "PUT" && !(await hasEmptyBody(request))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
      }
      if (method === "GET") {
        const data = await ownServicePhoto(env.DB, token, id, download);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"NOT_FOUND",message:"Service unavailable"}},404);
      }
      const jpeg = method === "PUT" ? await readServicePhotoBody(request) : null;
      if (method === "PUT" && !validServicePhoto(jpeg)) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service photo"}},400);
      }
      const data = jpeg === null ? await clearServicePhoto(env.DB, token, id, Number(revision))
        : await submitServicePhoto(env.DB, token, id, Number(revision), jpeg);
      return data ? json({ok:true,data})
        : json({ok:false,error:{code:"CONFLICT",message:"Service photo changed"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service photo unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/listings/photo") {
    const methodError = getOnly(request);
    if (methodError) return methodError;
    const params = url.searchParams;
    const id = params.get("id"), categoryId = params.get("categoryId"), city = params.get("city");
    if (!validOpaqueId(id) || !validCategoryId(categoryId) ||
        params.getAll("id").length !== 1 || params.getAll("categoryId").length !== 1 ||
        !(city === null ? params.size === 2 : params.size === 3 && validServiceCity(city)) ||
        !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service photo query"}},400);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service photo unavailable"}},503);
    try {
      const data = await publicServicePhoto(env.DB, id, categoryId, validServiceCity(city) ? city : null);
      return data ? json({ok:true,data})
        : json({ok:false,error:{code:"NOT_FOUND",message:"Photo unavailable"}},404);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service photo unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/service-details") {
    const method = request.method;
    if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, PUT, DELETE"});
    }
    const id = url.searchParams.get("id"), revision = url.searchParams.get("revision");
    if (!validOpaqueId(id) || url.searchParams.getAll("id").length !== 1 ||
        (method === "GET" ? url.searchParams.size !== 1 :
          url.searchParams.size !== 2 || revision === null || !/^(?:0|[1-9][0-9]{0,9})$/.test(revision))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service details query"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service details unavailable"}},503);
    try {
      if (method !== "PUT" && !(await hasEmptyBody(request))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
      }
      if (method === "GET") {
        const data = await readOwnServiceDetails(env.DB, token, id);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"NOT_FOUND",message:"Service unavailable"}},404);
      }
      const expected = Number(revision);
      if (method === "DELETE") {
        const removed = await clearOwnServiceDetails(env.DB, token, id, expected);
        return removed ? json({ok:true,data:{details:null,revision:expected+1}})
          : json({ok:false,error:{code:"CONFLICT",message:"Service details changed"}},409);
      }
      const input = await readServiceDetailsBody(request);
      const details = input && parseServiceDetails(input);
      if (!details) return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service details"}},400);
      const saved = await submitOwnServiceDetails(env.DB, token, id, details, expected);
      return saved ? json({ok:true,data:{details:saved,revision:saved.revision}})
        : json({ok:false,error:{code:"CONFLICT",message:"Service details changed"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service details unavailable"}},503);
    }
  }
  if (url.pathname === "/api/v1/me/service-area") {
    const method = request.method;
    if (method !== "GET" && method !== "PUT") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, PUT"});
    }
    const id = url.searchParams.get("id");
    const revision = url.searchParams.get("revision");
    if (!validOpaqueId(id) || url.searchParams.getAll("id").length !== 1 ||
        (method === "GET" ? url.searchParams.size !== 1 :
          url.searchParams.size !== 2 || revision === null || !/^(?:0|[1-9][0-9]{0,9})$/.test(revision))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service area query"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service area unavailable"}},503);
    try {
      if (method === "GET") {
        if (!(await hasEmptyBody(request))) {
          return json({ok:false,error:{code:"INVALID_QUERY",message:"Unexpected input"}},400);
        }
        const data = await readOwnServiceArea(env.DB, token, id);
        return data ? json({ok:true,data})
          : json({ok:false,error:{code:"NOT_FOUND",message:"Service unavailable"}},404);
      }
      const city = await readServiceCityBody(request);
      if (city !== "none" && !validServiceCity(city)) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid service city"}},400);
      }
      const data = await changeOwnServiceArea(env.DB, token, id, city === "none" ? null : city, Number(revision));
      return data ? json({ok:true,data})
        : json({ok:false,error:{code:"CONFLICT",message:"Service changed or unavailable"}},409);
    } catch {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Service area unavailable"}},503);
    }
  }
  const callAvailability = url.pathname === "/api/v1/me/call-availability" && env.CALL_SIGNALING_ENABLED === "1";
  if (url.pathname === "/api/v1/me/call-preference" || callAvailability) {
    const method = request.method;
    if (method !== "GET" && method !== "POST") {
      return json({ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}},405,
        {Allow:"GET, POST"});
    }
    const params = url.searchParams;
    const enabled = params.get("enabled");
    const revision = params.get("revision");
    const validQuery = method === "GET" ? !url.search :
      params.size === 2 && (enabled === "0" || enabled === "1") &&
      revision !== null && /^(?:0|[1-9][0-9]{0,9})$/.test(revision) &&
      Number(revision) < 2147483647;
    if (!validQuery || !(await hasEmptyBody(request))) {
      return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid call preference input"}},400);
    }
    const token = bearerToken(request);
    if (!validSessionToken(token)) {
      return json({ok:false,error:{code:"UNAUTHORIZED",message:"Authentication required"}},401);
    }
    if (!env.DB) {
      return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Call preference unavailable"}},503);
    }
    if (method === "GET") {
      const availability = callAvailability ? await readOwnWorkerAvailability(env.DB, token) : null;
      const preference = callAvailability
        ? availability && {enabled:availability.acceptingCalls,revision:availability.revision}
        : await readOwnWorkerAgoraCallPreference(env.DB, token);
      return preference ? json({ok:true,data:preference})
        : json({ok:false,error:{code:"NOT_FOUND",message:"Call preference unavailable"}},404);
    }
    if (callAvailability) {
      const result = await setOwnWorkerAvailability(env.DB, token, enabled === "1", Number(revision));
      return result.kind === "updated"
        ? json({ok:true,data:{enabled:result.preference.acceptingCalls,revision:result.preference.revision}})
        : json({ok:false,error:{code:"CONFLICT",message:"Call availability changed or unavailable"}},409);
    }
    const result = await setOwnWorkerAgoraCallPreference(env.DB, token, enabled === "1", Number(revision));
    return result.kind === "updated" ? json({ok:true,data:result.preference})
      : json({ok:false,error:{code:"CONFLICT",message:"Call preference changed or unavailable"}},409);
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
      const view=params.get("view"),lang=params.get("lang"),city=params.get("city");
      const profile=params.get("profile");
      const approvedDetail=view==="service" &&
        (lang==="hi"||lang==="en") && (city === null || validServiceCity(city)) &&
        (profile === null || profile === "1") &&
        params.size === 3 + Number(city !== null) + Number(profile !== null) &&
        params.getAll("view").length===1 && params.getAll("lang").length===1 &&
        params.getAll("city").length <= 1 && params.getAll("profile").length <= 1;
      if(params.getAll("id").length!==1||!validOpaqueId(id)||
          !(view===null&&lang===null&&params.size===1 || approvedDetail)||
          !(await hasEmptyBody(request))) {
        return json({ok:false,error:{code:"INVALID_QUERY",message:"Invalid listing detail request"}},400);
      }
      if(!env.DB)return json({ok:false,error:{code:"SERVICE_UNAVAILABLE",message:"Listings unavailable"}},503);
      try {
        if(approvedDetail){
          const detail=await publicApprovedServiceDetail(env.DB,id!,lang as "hi"|"en",
            validServiceCity(city) ? city : undefined, profile === "1");
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
      const mode=params.get("feed"),limit=params.get("limit"),after=params.get("after");
      const lang=params.get("lang"), category=params.get("categoryId"), city=params.get("city");
      const localized = mode === "service" && (lang === "hi" || lang === "en");
      const allowed=new Set(["feed","limit","after","lang","categoryId","city"]);
      let invalid=!(mode === "all" && lang === null || localized) ||
        (category !== null && (!localized || !validCategoryId(category))) ||
        (city !== null && (!localized || !validServiceCity(city))) ||
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
        const page = lang === "hi" || lang === "en"
          ? await pageAllPublicListings(env.DB, Number(limit), after, lang, category ?? undefined,
              validServiceCity(city) ? city : undefined)
          : await pageAllPublicListings(env.DB, Number(limit), after);
        return json({ok:true,data:page});
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
        // Optional EXACT owner read for editing stale-device status and
        // deliberate uncertain-write observation. Never fall through to
        // a broader page or accept owner/identity IDs from the caller.
        if(url.searchParams.has("id")) {
          const params=url.searchParams;
          const mode=params.get("view");
          if(params.size!==2 || params.getAll("id").length!==1 ||
              params.getAll("view").length!==1 ||
              (mode!=="management"&&mode!=="revision") ||
              !validOpaqueId(params.get("id")) ||
              !(await hasEmptyBody(request))) {
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Invalid selected listing query"}},400);
          }
          const selected=mode==="revision"
            ? await exactVersionedOwnListing(
                env.DB,actor.accountId,params.get("id")!)
            : await exactManagedOwnListing(
                env.DB,actor.accountId,params.get("id")!);
          if(!selected)return json({ok:false,error:{
            code:"NOT_FOUND",message:"Listing not found"}},404);
          return json({ok:true,data:{listing:selected}});
        }
        if (url.searchParams.has("categoryId")) {
          const params = url.searchParams;
          const categoryId = params.get("categoryId");
          if (params.size !== 2 || params.get("view") !== "management" ||
              !validCategoryId(categoryId) || !(await hasEmptyBody(request))) {
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Invalid owner category lookup"}},400);
          }
          const listing = await exactManagedOwnListingByCategory(env.DB, actor.accountId, categoryId!);
          if (!listing) return json({ok:false,error:{code:"NOT_FOUND",message:"Listing not found"}},404);
          return json({ok:true,data:{listing}});
        }
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
        const create = url.searchParams.size === 1 && url.searchParams.get("create") === "1";
        // Opt-in reactivation ONLY of a specific previously unpublished own
        // Listing. Unlike regular Publish, never INSERT/UPSERT or create a
        // second row; existing moderation and current approval still apply.
        if (url.search && !create) {
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
        const listing = create
          ? await createOwnListing(env.DB, actor.accountId, categoryId)
          : await publishListing(env.DB, actor.accountId, categoryId);
        if (!listing) {
          if (create) return json({ok:false,error:{
            code:"CONFLICT",message:"Service already exists or is unavailable"}},409);
          return json({ok:false,error:{code:"FORBIDDEN",message:"Listing not eligible"}},403);
        }
        return json({ok:true,data:{listing}});
      }
      if(request.method==="PUT") {
        const publication = url.searchParams.get("publication");
        if (publication !== null) {
          const input = url.searchParams.size === 1 &&
              (publication === "pause" || publication === "resume")
            ? await readPublicationRevisionBody(request) : null;
          if (!input || (publication !== "pause" && publication !== "resume"))
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Invalid publication change"}},400);
          const listing = await changeOwnListingPublication(
            env.DB, actor.accountId, input.listingId, input.expectedCategoryId,
            input.expectedRevision, publication);
          if (!listing) return json({ok:false,error:{
            code:"CONFLICT",message:"Listing changed or unavailable"}},409);
          return json({ok:true,data:{listing}});
        }
        // Category-only edit: no new private fields or client-supplied actor.
        // Current worker+account, approved active destination, unique owner
        // category, moderation and expected previous Category are checked in
        // ONE atomic D1 UPDATE. A stale/foreign/duplicate row is one conflict.
        // Revision v2 is an explicit separate wire mode. It may only run
        // after forward migration 0011; absence is fail-closed 503 and
        // must NOT fall back to the old Category-only PUT.
        if(url.search) {
          const params=url.searchParams;
          if(params.size!==1 || params.getAll("revision").length!==1 ||
              params.get("revision")!=="1")
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Unexpected query"}},400);
          const edit=await readVersionedCategoryEditBody(request);
          if(!edit||!validOpaqueId(edit.listingId)||
              !validCategoryId(edit.expectedCategoryId)||
              !validCategoryId(edit.nextCategoryId)||
              edit.expectedCategoryId===edit.nextCategoryId)
            return json({ok:false,error:{
              code:"INVALID_QUERY",message:"Invalid revision edit"}},400);
          const changed=await editOwnListingCategoryVersioned(
            env.DB,actor.accountId,edit.listingId,
            edit.expectedCategoryId,edit.nextCategoryId,
            edit.expectedRevision);
          if(!changed)return json({ok:false,error:{
            code:"CONFLICT",message:"Listing changed or unavailable"}},409);
          return json({ok:true,data:{listing:changed}});
        }
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
