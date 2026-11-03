import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";
import { validOpaqueId } from "../shared/identifiers.ts";

const MAX_REVISION = 2_147_483_647;
const DENIED = Object.freeze({ kind: "denied" as const });

/**
 * M-003/M-005, LOCAL-ONLY private state. These preferences are NOT Agora
 * presence, real-call permissions, approved rate budgets or public APIs.
 * The founder approved engineering preparation; no retention or threshold
 * has yet been chosen. Missing rows and incomplete policy never grant calls.
 */
export type OwnWorkerAvailability = Readonly<{
  acceptingCalls: boolean;
  revision: number;
}>;

export const READ_OWN_AVAILABILITY_QUERY =
  "SELECT avail.accepting_calls AS acceptingCalls, avail.revision " +
  "FROM auth_sessions AS s " +
  "JOIN accounts AS owner ON owner.id=s.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=owner.id " +
  "LEFT JOIN worker_agora_availability_preferences AS avail " +
  "ON avail.account_id=owner.id " +
  "WHERE s.token_hash=? AND s.expires_at>? AND owner.status='active' " +
  "AND profile.status='draft' LIMIT 1";

export const INSERT_OWN_AVAILABILITY_QUERY =
  "INSERT INTO worker_agora_availability_preferences" +
  "(account_id,accepting_calls,revision) " +
  "SELECT owner.id,?,1 FROM auth_sessions AS s " +
  "JOIN accounts AS owner ON owner.id=s.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=owner.id " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND owner.status='active' AND profile.status='draft' " +
  "ON CONFLICT(account_id) DO NOTHING";

export const UPDATE_OWN_AVAILABILITY_QUERY =
  "UPDATE worker_agora_availability_preferences " +
  "SET accepting_calls=?,revision=revision+1 " +
  "WHERE revision=? AND revision<? AND account_id=(" +
  "SELECT owner.id FROM auth_sessions AS s " +
  "JOIN accounts AS owner ON owner.id=s.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=owner.id " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND owner.status='active' AND profile.status='draft' LIMIT 1)";

export async function readOwnWorkerAvailability(
  db: D1Database, bearer: string,
): Promise<OwnWorkerAvailability | null> {
  if (!validSessionToken(bearer)) return null;
  try {
    const { results } = await db.prepare(READ_OWN_AVAILABILITY_QUERY)
      .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000))
      .all<{ acceptingCalls: unknown; revision: unknown }>();
    if (!Array.isArray(results) || results.length !== 1) return null;
    const row = results[0];
    if (row?.acceptingCalls === null && row?.revision === null) {
      return Object.freeze({ acceptingCalls: false, revision: 0 });
    }
    if (!row || (row.acceptingCalls !== 0 && row.acceptingCalls !== 1) ||
        typeof row.revision !== "number" ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1 || row.revision > MAX_REVISION) return null;
    return Object.freeze({
      acceptingCalls: row.acceptingCalls === 1,
      revision: row.revision,
    });
  } catch {
    return null;
  }
}

/** Authenticated owner-only CAS: an opt-in for calls (ADR-0014) remains
 * independently default OFF. Setting available never enables Agora consent.
 * No HTTP route, notification, token or provider side effect is performed.
 */
export async function setOwnWorkerAvailability(
  db: D1Database, bearer: string,
  acceptingCalls: boolean, expectedRevision: number,
): Promise<Readonly<{ kind: "updated"; preference: OwnWorkerAvailability }> |
  Readonly<{ kind: "denied" }>> {
  if (!validSessionToken(bearer) ||
      typeof acceptingCalls !== "boolean" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 || expectedRevision >= MAX_REVISION) return DENIED;
  try {
    const hash = await sessionHash(bearer);
    const now = Math.floor(Date.now() / 1000);
    const statement = expectedRevision === 0
      ? db.prepare(INSERT_OWN_AVAILABILITY_QUERY)
        .bind(acceptingCalls ? 1 : 0, hash, now)
      : db.prepare(UPDATE_OWN_AVAILABILITY_QUERY)
        .bind(acceptingCalls ? 1 : 0, expectedRevision,
          MAX_REVISION, hash, now);
    const { meta } = await statement.run();
    if (meta?.changes !== 1) return DENIED;
    return Object.freeze({
      kind: "updated" as const,
      preference: Object.freeze({
        acceptingCalls, revision: expectedRevision + 1,
      }),
    });
  } catch {
    return DENIED;
  }
}

/** Directional block writes can be performed by the authenticated BLOCKER
 * only. Neither an arbitrary requester nor a worker can manipulate someone
 * else's blocker identity. No reason, phone or public block state is stored.
 */
export const INSERT_OWN_AGORA_BLOCK_QUERY =
  "INSERT INTO agora_account_blocks(blocker_account_id,blocked_account_id) " +
  "SELECT blocker.id,target.id FROM auth_sessions AS s " +
  "JOIN accounts AS blocker ON blocker.id=s.account_id " +
  "JOIN accounts AS target ON target.id=? AND target.status='active' " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND blocker.status='active' AND blocker.id<>target.id " +
  "ON CONFLICT(blocker_account_id,blocked_account_id) DO NOTHING";

export const DELETE_OWN_AGORA_BLOCK_QUERY =
  "DELETE FROM agora_account_blocks WHERE blocked_account_id=? " +
  "AND blocker_account_id=(SELECT blocker.id FROM auth_sessions AS s " +
  "JOIN accounts AS blocker ON blocker.id=s.account_id " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND blocker.status='active' LIMIT 1)";

/** Local authenticated and explicitly directed block/unblock rehearsal.
 * Denied is intentionally indistinguishable across absent target, forbidden
 * actor and duplicate/no-op requests. No arbitrary actor IDs are accepted.
 */
export async function setOwnAgoraAccountBlock(
  db: D1Database, blockerBearer: string,
  targetAccountId: string, blocked: boolean,
): Promise<Readonly<{ kind: "updated" }> |
  Readonly<{ kind: "denied" }>> {
  if (!validSessionToken(blockerBearer) ||
      !validOpaqueId(targetAccountId) ||
      typeof blocked !== "boolean") return DENIED;
  try {
    const hash = await sessionHash(blockerBearer);
    const now = Math.floor(Date.now() / 1000);
    const query = blocked
      ? INSERT_OWN_AGORA_BLOCK_QUERY : DELETE_OWN_AGORA_BLOCK_QUERY;
    const { meta } = await db.prepare(query)
      .bind(targetAccountId, hash, now).run();
    return meta?.changes === 1
      ? Object.freeze({ kind: "updated" as const })
      : DENIED;
  } catch {
    return DENIED;
  }
}

/** ONE private caller-owned D1 read: current listing/owner/category/moderation,
 * current explicit call consent, separate availability preference and BOTH
 * directional blocks. An omitted availability row means unavailable; no row
 * or bad adapter can fabricate affirmative state. This read does not know
 * whether a device is actually ONLINE, nor can it approve abuse/privacy.
 */
export const READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY =
  "SELECT pref.revision AS consentRevision, " +
  "avail.accepting_calls AS acceptingCalls, " +
  "avail.revision AS availabilityRevision, " +
  "EXISTS(SELECT 1 FROM agora_account_blocks AS b " +
  "WHERE b.blocker_account_id=caller.id " +
  "AND b.blocked_account_id=worker.id) AS blockedByCaller, " +
  "EXISTS(SELECT 1 FROM agora_account_blocks AS b " +
  "WHERE b.blocker_account_id=worker.id " +
  "AND b.blocked_account_id=caller.id) AS blockedByWorker " +
  "FROM auth_sessions AS s " +
  "JOIN accounts AS caller ON caller.id=s.account_id " +
  "JOIN worker_listings AS wl ON wl.id=? " +
  "JOIN accounts AS worker ON worker.id=wl.worker_account_id " +
  "JOIN worker_profiles AS wp ON wp.account_id=worker.id " +
  "JOIN categories AS c ON c.id=wl.category_id " +
  "JOIN worker_agora_call_preferences AS pref " +
  "ON pref.account_id=worker.id AND pref.calls_enabled=1 " +
  "LEFT JOIN worker_agora_availability_preferences AS avail " +
  "ON avail.account_id=worker.id " +
  "WHERE s.token_hash=? AND s.expires_at>? " +
  "AND caller.status='active' AND worker.status='active' " +
  "AND caller.id<>worker.id AND wp.status='draft' " +
  "AND c.is_active=1 AND wl.status='published' " +
  "AND wl.moderation_status='allowed' LIMIT 1";

export type LocalAgoraSafetyFacts = Readonly<{
  acceptingCalls: boolean;
  availabilityRevision: number;
  consentRevision: number;
  blockedByCaller: boolean;
  blockedByWorker: boolean;
  /** No approved anti-abuse threshold, period or rate reservation exists. */
  rateGate: "unknown";
  /** No actual device presence has been implemented. */
  workerPresence: "unknown";
}>;

export async function readLocalCallerAgoraSafetyFacts(
  db: D1Database, callerBearer: string, listingId: string,
): Promise<LocalAgoraSafetyFacts | null> {
  if (!validSessionToken(callerBearer) || !validOpaqueId(listingId)) return null;
  try {
    const { results } = await db.prepare(READ_CALLER_AGORA_PRIVATE_SAFETY_QUERY)
      .bind(listingId, await sessionHash(callerBearer),
        Math.floor(Date.now() / 1000))
      .all<{
        consentRevision: unknown; acceptingCalls: unknown;
        availabilityRevision: unknown;
        blockedByCaller: unknown; blockedByWorker: unknown;
      }>();
    if (!Array.isArray(results) || results.length !== 1) return null;
    const row = results[0];
    if (!row ||
        typeof row.consentRevision !== "number" ||
        !Number.isSafeInteger(row.consentRevision) ||
        row.consentRevision < 1 || row.consentRevision > MAX_REVISION ||
        (row.blockedByCaller !== 0 && row.blockedByCaller !== 1) ||
        (row.blockedByWorker !== 0 && row.blockedByWorker !== 1)) return null;
    const missing = row.acceptingCalls === null &&
      row.availabilityRevision === null;
    if (!missing &&
        ((row.acceptingCalls !== 0 && row.acceptingCalls !== 1) ||
         typeof row.availabilityRevision !== "number" ||
         !Number.isSafeInteger(row.availabilityRevision) ||
         row.availabilityRevision < 1 ||
         row.availabilityRevision > MAX_REVISION)) return null;
    return Object.freeze({
      acceptingCalls: !missing && row.acceptingCalls === 1,
      availabilityRevision: missing ? 0 : row.availabilityRevision as number,
      consentRevision: row.consentRevision,
      blockedByCaller: row.blockedByCaller === 1,
      blockedByWorker: row.blockedByWorker === 1,
      rateGate: "unknown" as const,
      workerPresence: "unknown" as const,
    });
  } catch {
    return null;
  }
}
