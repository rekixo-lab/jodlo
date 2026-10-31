import type { D1Database } from "../../data/d1.ts";
import { sessionHash, validSessionToken } from "../identity/sessions.ts";

/**
 * ADR-0014: the founder approved a distinct, revocable worker opt-in for
 * Agora Internet VOICE calls. No worker is callable by merely publishing.
 * This is a private preference, not online presence, incoming push consent,
 * a public endpoint, telephony, a call log or an RTC token grant.
 */
export type WorkerAgoraCallPreference = Readonly<{
  enabled: boolean;
  revision: number;
}>;

const MAX_REVISION = 2_147_483_647;

/** A worker without a preference row is strictly OFF. An active, unexpired
 * bearer and existing draft worker profile are necessary even for reading.
 * Null/invalid rows from broken adapters never get interpreted as opted in.
 */
export const READ_OWN_AGORA_CALL_PREFERENCE_QUERY =
  "SELECT preference.calls_enabled AS enabled, " +
  "preference.revision AS revision " +
  "FROM auth_sessions AS session " +
  "JOIN accounts AS account ON account.id=session.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=account.id " +
  "LEFT JOIN worker_agora_call_preferences AS preference " +
  "ON preference.account_id=profile.account_id " +
  "WHERE session.token_hash=? AND session.expires_at>? " +
  "AND account.status='active' AND profile.status='draft' LIMIT 1";

/** New preference creation is a single conditional write: the caller must
 * own the server-verified worker account at the moment of the INSERT.
 * CAS expectedRevision=0; a duplicate or concurrent retry is rejected.
 */
export const INSERT_AGORA_CALL_PREFERENCE_QUERY =
  "INSERT INTO worker_agora_call_preferences(account_id,calls_enabled,revision) " +
  "SELECT account.id,?,1 FROM auth_sessions AS session " +
  "JOIN accounts AS account ON account.id=session.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=account.id " +
  "WHERE session.token_hash=? AND session.expires_at>? " +
  "AND account.status='active' AND profile.status='draft' " +
  "ON CONFLICT(account_id) DO NOTHING";

/** Existing preference changes use a single UPDATE with owner-scoped live
 * bearer verification and strict compare-and-swap; no stale snapshot check.
 */
export const UPDATE_AGORA_CALL_PREFERENCE_QUERY =
  "UPDATE worker_agora_call_preferences SET calls_enabled=?, revision=revision+1 " +
  "WHERE revision=? AND revision<? AND account_id=(" +
  "SELECT account.id FROM auth_sessions AS session " +
  "JOIN accounts AS account ON account.id=session.account_id " +
  "JOIN worker_profiles AS profile ON profile.account_id=account.id " +
  "WHERE session.token_hash=? AND session.expires_at>? " +
  "AND account.status='active' AND profile.status='draft' LIMIT 1)";

export async function readOwnWorkerAgoraCallPreference(
  db: D1Database,
  bearer: string,
): Promise<WorkerAgoraCallPreference | null> {
  if (!validSessionToken(bearer)) return null;
  try {
    const { results } = await db.prepare(READ_OWN_AGORA_CALL_PREFERENCE_QUERY)
      .bind(await sessionHash(bearer), Math.floor(Date.now() / 1000))
      .all<{ enabled: unknown; revision: unknown }>();
    if (!Array.isArray(results) || results.length !== 1) return null;
    const row = results[0];
    if (!row || typeof row !== "object") return null;
    if (row.enabled === null && row.revision === null) {
      return Object.freeze({ enabled: false, revision: 0 });
    }
    if ((row.enabled !== 0 && row.enabled !== 1) ||
        !Number.isSafeInteger(row.revision) ||
        typeof row.revision !== "number" ||
        row.revision < 1 || row.revision > MAX_REVISION) return null;
    return Object.freeze({ enabled: row.enabled === 1, revision: row.revision });
  } catch {
    return null;
  }
}

/** Local D1-only owner-scoped worker preference mutation.
 * Callers must supply the EXACT current revision obtained from their own
 * authenticated read. After a successful toggle, previous versions fail.
 * A rejected write never returns a worker/account identifier or raw token.
 * This does NOT enable a real call/route/Agora SDK.
 */
export async function setOwnWorkerAgoraCallPreference(
  db: D1Database,
  bearer: string,
  enabled: boolean,
  expectedRevision: number,
): Promise<Readonly<{ kind: "updated"; preference: WorkerAgoraCallPreference }> |
  Readonly<{ kind: "denied" }>> {
  if (!validSessionToken(bearer) ||
      typeof enabled !== "boolean" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 || expectedRevision >= MAX_REVISION) {
    return { kind: "denied" };
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const hash = await sessionHash(bearer);
    const statement = expectedRevision === 0 ?
      db.prepare(INSERT_AGORA_CALL_PREFERENCE_QUERY).bind(enabled ? 1 : 0, hash, now) :
      db.prepare(UPDATE_AGORA_CALL_PREFERENCE_QUERY).bind(
        enabled ? 1 : 0, expectedRevision, MAX_REVISION, hash, now);
    const { meta } = await statement.run();
    if (meta?.changes !== 1) return { kind: "denied" };
    return Object.freeze({
      kind: "updated" as const,
      preference: Object.freeze({ enabled, revision: expectedRevision + 1 }),
    });
  } catch {
    return { kind: "denied" };
  }
}
