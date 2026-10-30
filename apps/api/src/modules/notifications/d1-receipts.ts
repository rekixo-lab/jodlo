import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import type { NotificationReceiptStore } from "./delivery.ts";

/** A lease outlives the bounded 5-second provider call. It is a recovery
 * window, NOT a guarantee of exactly-once external FCM delivery.
 */
export const NOTIFICATION_CLAIM_LEASE_MS = 15_000;

/** One SQLite UPSERT atomically creates the claim or takes over an EXPIRED
 * claim. A live claim or a completed receipt is immutable to other workers.
 * All values are bound; no separate SELECT-then-INSERT race.
 */
export const CLAIM_NOTIFICATION_QUERY =
  "INSERT INTO notification_delivery_receipts" +
  "(event_id,state,claim_token,lease_until_ms) VALUES(?,'claimed',?,?) " +
  "ON CONFLICT(event_id) DO UPDATE SET " +
  "claim_token=excluded.claim_token,lease_until_ms=excluded.lease_until_ms " +
  "WHERE notification_delivery_receipts.state='claimed' " +
  "AND notification_delivery_receipts.lease_until_ms<=?";

export const READ_NOTIFICATION_CLAIM_QUERY =
  "SELECT state FROM notification_delivery_receipts WHERE event_id=? LIMIT 1";

/** A stale sender cannot mark a reclaimed event completed. The current
 * fencing token AND current unexpired lease must still match.
 */
export const COMPLETE_NOTIFICATION_QUERY =
  "UPDATE notification_delivery_receipts SET state='completed'," +
  "claim_token=NULL,lease_until_ms=NULL,completed_at_ms=? " +
  "WHERE event_id=? AND state='claimed' AND claim_token=? AND lease_until_ms>?";

export const RELEASE_NOTIFICATION_QUERY =
  "DELETE FROM notification_delivery_receipts " +
  "WHERE event_id=? AND state='claimed' AND claim_token=?";

function checkedClock(now: () => number): number {
  const ms = now();
  if (!Number.isSafeInteger(ms) || ms < 0 ||
      !Number.isSafeInteger(ms + NOTIFICATION_CLAIM_LEASE_MS)) {
    throw new Error("Invalid notification lease clock");
  }
  return ms;
}

/** Real D1 persistence adapter (locally tested, NOT connected to a live
 * Queue consumer). Caller must provide a D1 binding migrated through 0005.
 * A different store instance or Worker isolate sees the same D1 receipts.
 *
 * The clock injection is exclusively for deterministic local tests; normal
 * Worker use passes no clock. This does NOT choose notification retention or
 * any approved delivery event. The recipient/event is not stored in this table.
 */
export function makeD1NotificationReceiptStore(
  db: D1Database, now: () => number = Date.now,
): NotificationReceiptStore {
  return {
    async acquire(eventId) {
      if (!validOpaqueId(eventId)) throw new Error("Invalid event ID");
      const ms = checkedClock(now);
      const claimToken = crypto.randomUUID();
      const changed = await db.prepare(CLAIM_NOTIFICATION_QUERY)
        .bind(eventId, claimToken, ms + NOTIFICATION_CLAIM_LEASE_MS, ms).run();
      if (changed.meta.changes === 1) {
        return { state: "acquired" as const, claimToken };
      }
      const { results } = await db.prepare(READ_NOTIFICATION_CLAIM_QUERY)
        .bind(eventId).all<{ state: string }>();
      const state = results[0]?.state;
      if (state === "completed") return { state: "completed" as const };
      if (state === "claimed") return { state: "busy" as const };
      // A missing/invalid row or SQL race cannot authorize a send.
      throw new Error("Notification claim unavailable");
    },
    async markCompleted(eventId, claimToken) {
      if (!validOpaqueId(eventId) || !validOpaqueId(claimToken)) {
        throw new Error("Invalid notification claim");
      }
      const ms = checkedClock(now);
      const { meta } = await db.prepare(COMPLETE_NOTIFICATION_QUERY)
        .bind(ms, eventId, claimToken, ms).run();
      if (meta.changes !== 1) {
        throw new Error("Notification claim expired or reassigned");
      }
    },
    async release(eventId, claimToken) {
      if (!validOpaqueId(eventId) || !validOpaqueId(claimToken)) {
        throw new Error("Invalid notification claim");
      }
      // Conditional release is safe even when an expired lease was taken
      // over by another worker. It never deletes someone else's claim.
      await db.prepare(RELEASE_NOTIFICATION_QUERY)
        .bind(eventId, claimToken).run();
    },
  };
}
