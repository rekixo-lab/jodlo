import type { D1Database } from "../../data/d1.ts";
import { validOpaqueId } from "../shared/identifiers.ts";
import type { NotificationDeadLetters } from "./delivery.ts";

export const RECORD_NOTIFICATION_DEAD_LETTER_QUERY =
  "INSERT INTO notification_delivery_dead_letters(event_id,reason,recorded_at_ms) " +
  "VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING";

const REASONS = new Set(["PERMANENT_FAILURE", "RETRIES_EXHAUSTED"]);

/** Durable, idempotent first-write-wins audit of exhausted/permanent failures.
 * The event ID MUST be opaque and server-owned; never write user or device data.
 * A successful record() means only the D1 write committed, not a live Queue ack.
 * Retention/cleanup requires future privacy and operational approval.
 */
export function makeD1NotificationDeadLetters(
  db: D1Database, now: () => number = Date.now,
): NotificationDeadLetters {
  return {
    async record(eventId, reason) {
      if (!validOpaqueId(eventId) || !REASONS.has(reason)) {
        throw new Error("Invalid notification dead letter");
      }
      const ms = now();
      if (!Number.isSafeInteger(ms) || ms < 0) {
        throw new Error("Invalid notification dead-letter clock");
      }
      const { meta } = await db.prepare(RECORD_NOTIFICATION_DEAD_LETTER_QUERY)
        .bind(eventId, reason, ms).run();
      // First insert writes one row; a retry of an existing event is harmless.
      // Missing/untrusted D1 write metadata MUST NOT authorize Queue ack.
      if (meta.changes !== 0 && meta.changes !== 1) {
        throw new Error("Notification dead-letter write unconfirmed");
      }
    },
  };
}
