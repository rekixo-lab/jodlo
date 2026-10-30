import { validOpaqueId } from "../shared/identifiers.ts";

/** Cloudflare Queue-compatible shape. This is NOT a registered queue consumer.
 * A future approved Worker entrypoint must wire it to a real Queue binding.
 */
export interface NotificationQueueMessage {
  readonly body: unknown;
  /** Queue delivery count, starting at 1. Never trust a body-provided counter. */
  readonly attempts: number;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

/** No free-form content, phone, email, device token, GPS or money in queued data.
 * These server-owned references are NOT permission to notify a user.
 */
export type NotificationEnvelope = Readonly<{
  kind: "notification_delivery_v1";
  eventId: string;
  recipientAccountId: string;
  eventType: string;
  createdAtMs: number;
  expiresAtMs: number;
}>;

/** All four facts must be fetched from trusted current state on EVERY attempt.
 * No actual notification category or recipient eligibility is approved here.
 */
export type DeliveryEligibility = Readonly<{
  recipientActive: boolean;
  consentGranted: boolean;
  eventApprovedByPolicy: boolean;
  destinationApproved: boolean;
}>;

/** An accepted push means a transport accepted the request, not device receipt. */
export interface NotificationProvider {
  send(job: NotificationEnvelope): Promise<"accepted" | "transient" | "permanent">;
}

/** Future adapter MUST acquire atomically and durably; ordinary in-memory
 * Sets are not sufficient across Cloudflare Workers/at-least-once delivery.
 * A lost acknowledgement after a provider accepted still permits a duplicate;
 * exactly-once external effects are NOT promised by this contract.
 */
export interface NotificationReceiptStore {
  acquire(eventId: string): Promise<"acquired" | "completed" | "busy">;
  markCompleted(eventId: string): Promise<void>;
  release(eventId: string): Promise<void>;
}

/** A durable dead-letter audit must complete before an exhausted message is
 * acknowledged. Never include tokens or recipient identifiers in dead letter.
 */
export interface NotificationDeadLetters {
  record(eventId: string, reason: "PERMANENT_FAILURE" | "RETRIES_EXHAUSTED"): Promise<void>;
}

export type NotificationDeliveryDeps = Readonly<{
  eligibility(job: NotificationEnvelope): Promise<DeliveryEligibility | null>;
  provider: NotificationProvider;
  receipts: NotificationReceiptStore;
  deadLetters: NotificationDeadLetters;
}>;

export type NotificationOutcome =
  "delivered" | "duplicate" | "rejected" | "retry" | "dead_lettered";

export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const MAX_NOTIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_PROVIDER_TIMEOUT_MS = 5_000;
const KINDS = ["kind", "eventId", "recipientAccountId", "eventType", "createdAtMs", "expiresAtMs"];

function validNotification(body: unknown, nowMs: number): body is NotificationEnvelope {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const data = body as Record<string, unknown>;
  if (Object.keys(data).length !== KINDS.length ||
      KINDS.some(key => !Object.hasOwn(data, key))) return false;
  return data.kind === "notification_delivery_v1" &&
    validOpaqueId(data.eventId) && validOpaqueId(data.recipientAccountId) &&
    typeof data.eventType === "string" && /^[a-z][a-z_]{1,31}$/.test(data.eventType) &&
    Number.isSafeInteger(data.createdAtMs) && Number.isSafeInteger(data.expiresAtMs) &&
    (data.createdAtMs as number) >= 0 &&
    (data.createdAtMs as number) <= nowMs + 60_000 &&
    (data.expiresAtMs as number) > (data.createdAtMs as number) &&
    (data.expiresAtMs as number) - (data.createdAtMs as number) <= MAX_NOTIFICATION_LIFETIME_MS;
}

/** Explicit, bounded exponential backoff. Queue controls actual scheduling. */
export function notificationRetryDelaySeconds(attempts: number): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) return 5;
  return Math.min(300, 5 * 2 ** Math.min(6, attempts - 1));
}

function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Provider deadline")), deadlineMs);
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

/** Trust boundary: reject unknown/expired jobs, then re-check current consent,
 * approved type, recipient and destination before touching the provider.
 * The provider and receipt store are injected; no live FCM/Queue/FCM SDK.
 *
 * A non-idempotent provider may accept an event but time out before returning.
 * This design is deliberately at-least-once, NOT proof of exactly-once pushes.
 */
export async function deliverNotificationMessage(
  message: NotificationQueueMessage,
  deps: NotificationDeliveryDeps,
  nowMs = Date.now(),
  providerTimeoutMs = NOTIFICATION_PROVIDER_TIMEOUT_MS,
): Promise<NotificationOutcome> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(message.attempts) || message.attempts < 1 ||
      !Number.isSafeInteger(providerTimeoutMs) ||
      providerTimeoutMs < 1 || providerTimeoutMs > NOTIFICATION_PROVIDER_TIMEOUT_MS ||
      !validNotification(message.body, nowMs)) {
    message.ack();
    return "rejected";
  }
  const job = message.body;
  if (job.expiresAtMs <= nowMs) {
    message.ack();
    return "rejected";
  }

  async function fail(reason: "PERMANENT_FAILURE" | "RETRIES_EXHAUSTED"):
    Promise<NotificationOutcome> {
    try {
      await deps.deadLetters.record(job.eventId, reason);
      message.ack();
      return "dead_lettered";
    } catch {
      // Never ack an unsuccessful dead-letter write.
      message.retry({ delaySeconds: notificationRetryDelaySeconds(message.attempts) });
      return "retry";
    }
  }
  async function retry(): Promise<NotificationOutcome> {
    if (message.attempts >= MAX_NOTIFICATION_ATTEMPTS) return fail("RETRIES_EXHAUSTED");
    const delaySeconds = notificationRetryDelaySeconds(message.attempts);
    if (nowMs + delaySeconds * 1000 >= job.expiresAtMs) {
      message.ack();
      return "rejected";
    }
    message.retry({ delaySeconds });
    return "retry";
  }

  try {
    const approval = await deps.eligibility(job);
    if (!approval || approval.recipientActive !== true ||
        approval.consentGranted !== true ||
        approval.eventApprovedByPolicy !== true ||
        approval.destinationApproved !== true) {
      // A policy denial must never be retried into a later unintended send.
      message.ack();
      return "rejected";
    }
  } catch {
    // A temporary source-of-truth outage is not proof that consent was denied.
    return retry();
  }

  let acquired = false;
  try {
    const state = await deps.receipts.acquire(job.eventId);
    if (state === "completed") {
      message.ack();
      return "duplicate";
    }
    if (state !== "acquired") return retry();
    acquired = true;

    // Provider call is bounded; if it times out, the external side effect
    // remains uncertain and the retry/idempotency store is essential.
    const delivered = await withDeadline(deps.provider.send(job), providerTimeoutMs);
    if (delivered === "accepted") {
      await deps.receipts.markCompleted(job.eventId);
      acquired = false;
      message.ack();
      return "delivered";
    }
    if (delivered === "permanent") {
      await deps.receipts.release(job.eventId);
      acquired = false;
      return fail("PERMANENT_FAILURE");
    }
    // Unknown provider replies are never treated as success.
  } catch {
    // Deliberately sanitized: never return provider/recipient details.
  }
  if (acquired) {
    try { await deps.receipts.release(job.eventId); } catch { /* retry fails closed */ }
  }
  return retry();
}
