import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validCategoryId, validOpaqueId } from "../shared/identifiers.ts";
import type { ContactSafetyFacts } from "./contact-safety.ts";

/**
 * Trusted current D1 facts for a FUTURE customer-to-worker interaction.
 * Does not supply worker phone, call consent, privacy method, availability,
 * blocks, or call abuse policy: the result is never connection authorization.
 */
export type RequestTargetFacts = Readonly<Pick<ContactSafetyFacts,
  "requesterAccountId" | "workerAccountId" | "listingId" |
  "listingOwnerAccountId" | "categoryId" | "requesterActive" |
  "workerActive" | "workerOptedIn" | "categoryActive" |
  "listingPublished" | "moderationApproved"
>>;

/** Reuse the exact account/listing/Category source projection for both legacy
 * trusted-account reads and the stronger, single-statement session-bound read.
 * A stale browser preview or a separate session lookup is NOT call permission.
 */
const REQUEST_TARGET_SOURCE_QUERY =
  "SELECT requester.id AS requesterId,requester.status AS requesterStatus, " +
  "worker.id AS workerAccountId,worker.status AS workerStatus, " +
  "wl.id AS listingId,wl.worker_account_id AS listingOwnerAccountId, " +
  "wl.category_id AS categoryId,wl.status AS listingStatus, " +
  "wl.moderation_status AS moderationStatus, " +
  "wp.status AS workerProfileStatus,c.is_active AS categoryActive " +
  "FROM worker_listings AS wl " +
  "JOIN accounts AS worker ON worker.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=worker.id " +
  "JOIN categories AS c ON c.id=wl.category_id ";

/** Existing trusted-account read. This is only for internal *previews*;
 * caller resolves requester from a verified server session beforehand.
 */
export const READ_CURRENT_REQUEST_TARGET_QUERY =
  REQUEST_TARGET_SOURCE_QUERY +
  "JOIN accounts AS requester ON requester.id=? " +
  "WHERE wl.id=? LIMIT 1";

/** A call's session must not be checked separately from its target: a
 * logout/expiry/disable between those two reads could leave stale approval.
 * One statement binds ONLY the SHA-256 token hash, trusted current time and
 * opaque listing ID; current requester ownership is resolved inside D1.
 *
 * Still only a read; future disclosure/connect requires additional M-003/M-005
 * policy and race-safe enforcement at the actual contact boundary.
 */
const SESSION_BOUND_TARGET_QUERY =
  REQUEST_TARGET_SOURCE_QUERY +
  "JOIN auth_sessions AS session ON session.token_hash=? AND session.expires_at>? " +
  "JOIN accounts AS requester ON requester.id=session.account_id " +
  "WHERE wl.id=? AND requester.status='active' ";

/** Existing caller-only preview, preserving the three-parameter contract. */
export const READ_SESSION_BOUND_CALL_TARGET_QUERY =
  SESSION_BOUND_TARGET_QUERY + "LIMIT 1";

/** A caller-initiated Agora INVITE must NEVER require or accept a worker
 * bearer token from the caller. The server derives the worker exclusively
 * from the listing owner, and rechecks the worker's current private opt-in
 * alongside the customer's own active bearer in ONE D1 SELECT.
 *
 * This is a fail-closed local-only preview, not a call grant. Availability,
 * blocking, anti-abuse and actual signaling remain unapproved M-005 facts.
 */
export const READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY =
  SESSION_BOUND_TARGET_QUERY +
  "AND worker.status='active' AND wp.status='draft' " +
  "AND wl.status='published' AND wl.moderation_status='allowed' " +
  "AND c.is_active=1 AND requester.id<>worker.id " +
  "AND EXISTS (SELECT 1 FROM worker_agora_call_preferences AS pref " +
  "WHERE pref.account_id=worker.id AND pref.calls_enabled=1) LIMIT 1";

/** Two current bearer proofs must match their DIFFERENT actual accounts
 * inside the same SQLite/D1 statement. The worker token is compared only
 * against the worker owning this listing, never a body-selected worker ID.
 * This is NOT atomic RTC credential issuance or an approved call.
 */
const WORKER_SESSION_OWNER_CONDITION =
  "AND EXISTS (SELECT 1 FROM auth_sessions AS worker_session " +
  "WHERE worker_session.account_id=worker.id " +
  "AND worker_session.token_hash=? AND worker_session.expires_at>?) ";

/** Default-OFF founder-approved worker Agora call opt-in must be read
 * in the SAME current-session/listing SELECT, not from a cached profile.
 * This remains a read-only prerequisite, not an RTC token grant.
 */
export const READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY =
  SESSION_BOUND_TARGET_QUERY + WORKER_SESSION_OWNER_CONDITION +
  "AND EXISTS (SELECT 1 FROM worker_agora_call_preferences AS pref " +
  "WHERE pref.account_id=worker.id AND pref.calls_enabled=1) LIMIT 1";

export const READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY =
  SESSION_BOUND_TARGET_QUERY + WORKER_SESSION_OWNER_CONDITION + "LIMIT 1";

/** Future worker's OWN Agora RTC-join proof. A worker never supplies the
 * customer's bearer. The caller account comes only from a trusted internal
 * call snapshot (not a client-selected value) and is verified active here;
 * the recipient is resolved from the current listing's actual owner.
 *
 * This one D1 SELECT checks the worker's OWN active session, worker consent,
 * listing moderation/publication, Category and both account states together.
 * Read-only synthetic prerequisite, NEVER a token or a real call grant.
 */
export const READ_WORKER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY =
  REQUEST_TARGET_SOURCE_QUERY +
  "JOIN auth_sessions AS participant_session " +
  "ON participant_session.account_id=worker.id " +
  "AND participant_session.token_hash=? AND participant_session.expires_at>? " +
  "JOIN accounts AS requester ON requester.id=? " +
  "WHERE wl.id=? AND worker.status='active' AND requester.status='active' " +
  "AND requester.id<>worker.id AND wp.status='draft' " +
  "AND wl.status='published' AND wl.moderation_status='allowed' " +
  "AND c.is_active=1 " +
  "AND EXISTS (SELECT 1 FROM worker_agora_call_preferences AS pref " +
  "WHERE pref.account_id=worker.id AND pref.calls_enabled=1) LIMIT 1";

type RequestTargetRow = {
  requesterId: unknown;
  requesterStatus: unknown;
  workerAccountId: unknown;
  workerStatus: unknown;
  listingId: unknown;
  listingOwnerAccountId: unknown;
  categoryId: unknown;
  listingStatus: unknown;
  moderationStatus: unknown;
  workerProfileStatus: unknown;
  categoryActive: unknown;
};

/** One shared, fail-closed hydration boundary. A malformed fake/D1 row never
 * becomes an eligible account, and no private fields enter the return value.
 */
function projectRequestTarget(
  rows: unknown,
  listingId: string,
  expectedRequesterId: string | null,
): RequestTargetFacts | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row: RequestTargetRow = rows[0];
  if (!row || typeof row !== "object" ||
      !validOpaqueId(row.requesterId) ||
      (expectedRequesterId !== null && row.requesterId !== expectedRequesterId) ||
      row.listingId !== listingId ||
      !validOpaqueId(row.workerAccountId) ||
      row.workerAccountId !== row.listingOwnerAccountId ||
      !validCategoryId(row.categoryId) ||
      !["active", "disabled"].includes(row.requesterStatus as string) ||
      !["active", "disabled"].includes(row.workerStatus as string) ||
      row.workerProfileStatus !== "draft" ||
      !["published", "unpublished"].includes(row.listingStatus as string) ||
      !["allowed", "hidden"].includes(row.moderationStatus as string) ||
      (row.categoryActive !== 0 && row.categoryActive !== 1)) {
    return null;
  }
  return Object.freeze({
    requesterAccountId: row.requesterId,
    workerAccountId: row.workerAccountId,
    listingId,
    listingOwnerAccountId: row.listingOwnerAccountId as string,
    categoryId: row.categoryId,
    requesterActive: row.requesterStatus === "active",
    workerActive: row.workerStatus === "active",
    workerOptedIn: row.workerProfileStatus === "draft",
    categoryActive: row.categoryActive === 1,
    listingPublished: row.listingStatus === "published",
    moderationApproved: row.moderationStatus === "allowed",
  });
}

/** Internal preview of server-owned status. A missing/corrupt row fails
 * closed; D1 outages reject instead of fabricating allowed facts.
 * This must not be reused as a call consent/disclosure decision.
 */
export async function readCurrentRequestTarget(
  db: D1Database,
  requesterId: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  if (!validOpaqueId(requesterId) || !validOpaqueId(listingId)) return null;
  const { results } = await db.prepare(READ_CURRENT_REQUEST_TARGET_QUERY)
    .bind(requesterId, listingId).all<RequestTargetRow>();
  return projectRequestTarget(results, listingId, requesterId);
}

/** Strict one-statement call preflight: current unexpired, non-revoked,
 * ACTIVE caller session and CURRENT listing/owner/category state share the
 * same SQLite/D1 SELECT. No caller-supplied account ID or worker identity.
 *
 * Deny unknown/invalid tokens without even touching D1. Token values never
 * reach SQL, logs or the projection; only the SHA-256 digest is bound.
 * Not a call credential or authorization to display any phone number.
 */
async function readCallerTargetWithQuery(
  db: D1Database,
  bearerToken: string,
  listingId: string,
  query: string,
): Promise<RequestTargetFacts | null> {
  if (!validSessionToken(bearerToken) || !validOpaqueId(listingId)) return null;
  const { results } = await db.prepare(query)
    .bind(await sessionHash(bearerToken), Math.floor(Date.now() / 1000), listingId)
    .all<RequestTargetRow>();
  const result = projectRequestTarget(results, listingId, null);
  // Never accept a fake adapter that violates the caller active predicate.
  return result?.requesterActive ? result : null;
}

export function readSessionBoundCallTarget(
  db: D1Database,
  bearerToken: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  return readCallerTargetWithQuery(
    db, bearerToken, listingId, READ_SESSION_BOUND_CALL_TARGET_QUERY);
}

/** Caller-initiated, phone-free INVITATION preflight. Requires ONLY the
 * caller's live session (SHA-256 hash), listing ID and a verified, enabled
 * worker call preference. The worker account comes from D1, NEVER a caller
 * parameter. This read intentionally does not require the worker to hold
 * a current session: a session is not online presence or push availability.
 *
 * We recheck projection invariants in case a fake/broken D1 adapter returns
 * rows in violation of SQL predicates. This does NOT verify actual live
 * availability/blocks/abuse, reserve a call slot or authorize Agora RTC.
 */
export async function readCallerSessionBoundAgoraOptInTarget(
  db: D1Database,
  callerBearer: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  const facts = await readCallerTargetWithQuery(
    db, callerBearer, listingId, READ_CALLER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY,
  );
  return facts?.requesterActive && facts.workerActive &&
    facts.workerOptedIn && facts.categoryActive &&
    facts.listingPublished && facts.moderationApproved &&
    facts.requesterAccountId !== facts.workerAccountId ? facts : null;
}


/**
 * LOCAL-ONLY preflight for future Agora RTC participant authorization.
 * One consistent D1 SELECT rechecks BOTH sessions and the current listing,
 * worker owner, Category, and moderation. Caller and worker bearer secrets
 * are never logged, returned or sent to SQL (only their SHA-256 hashes).
 *
 * This does NOT issue an RTC/Signaling token, provision a channel, store
 * call data or establish real authorization to connect. A future issuer must
 * recheck eligibility AT its race-safe token-grant boundary and honor M-003,
 * M-005, M-006 and M-007 gates. The worker session alone does not prove
 * worker call opt-in, notification/push consent or device availability.
 */
async function readTwoBoundSessions(
  db: D1Database,
  callerToken: string,
  workerToken: string,
  listingId: string,
  query: string,
): Promise<RequestTargetFacts | null> {
  if (!validSessionToken(callerToken) ||
      !validSessionToken(workerToken) ||
      callerToken === workerToken ||
      !validOpaqueId(listingId)) return null;
  const now = Math.floor(Date.now() / 1000);
  const { results } = await db.prepare(query)
    .bind(await sessionHash(callerToken), now, listingId,
      await sessionHash(workerToken), now)
    .all<RequestTargetRow>();
  const facts = projectRequestTarget(results, listingId, null);
  return facts?.requesterActive && facts.workerActive &&
    facts.requesterAccountId !== facts.workerAccountId ? facts : null;
}

/** Existing session-only preview deliberately retained for earlier tests.
 * This is never a substitute for the stricter Agora call opt-in read.
 */
export function readTwoSessionBoundCallTarget(
  db: D1Database,
  callerToken: string,
  workerToken: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  return readTwoBoundSessions(
    db, callerToken, workerToken, listingId, READ_TWO_SESSION_BOUND_CALL_TARGET_QUERY);
}

/** An actual CALL preflight requires the owner's CURRENT, explicit opt-in
 * inside the same D1 SELECT as both live sessions + listing + Category.
 * Missing row or disabled switch => denied even if listing is published.
 * This is NOT a token grant and does not replace other live safety checks.
 */
export function readTwoSessionBoundAgoraOptInTarget(
  db: D1Database,
  callerToken: string,
  workerToken: string,
  listingId: string,
): Promise<RequestTargetFacts | null> {
  return readTwoBoundSessions(
    db, callerToken, workerToken, listingId,
    READ_TWO_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY);
}



/**
 * Separate WORKER-owned RTC JOIN proof. Unlike the first-caller invitation
 * reader, this can run only when a trusted internal accepted call snapshot
 * already names its caller; it NEVER receives the caller's bearer.
 *
 * Expected caller ID must be server-held call state in a future durable
 * implementation, not an ID from client JSON or a header. Invalid inputs
 * fail before D1. Both accounts, listing state and worker consent must
 * remain eligible. Not a real RTC credential or grant.
 */
export async function readWorkerSessionBoundAgoraOptInTarget(
  db: D1Database,
  workerBearer: string,
  listingId: string,
  trustedCallerAccountId: string,
): Promise<RequestTargetFacts | null> {
  if (!validSessionToken(workerBearer) ||
      !validOpaqueId(listingId) ||
      !validOpaqueId(trustedCallerAccountId)) return null;
  const { results } = await db.prepare(READ_WORKER_SESSION_BOUND_AGORA_OPT_IN_TARGET_QUERY)
    .bind(await sessionHash(workerBearer), Math.floor(Date.now() / 1000),
      trustedCallerAccountId, listingId)
    .all<RequestTargetRow>();
  const facts = projectRequestTarget(results, listingId, trustedCallerAccountId);
  return facts?.requesterActive && facts.workerActive &&
    facts.workerOptedIn && facts.categoryActive &&
    facts.listingPublished && facts.moderationApproved &&
    facts.requesterAccountId !== facts.workerAccountId ? facts : null;
}
