import { validOpaqueId } from "../shared/identifiers.ts";
import {
  NOTIFICATION_PROVIDER_TIMEOUT_MS,
  type NotificationEnvelope,
  type NotificationProvider,
} from "./delivery.ts";

type FcmProviderDependencies = Readonly<{
  projectId: string;
  /** Server-side source of a short-lived Firebase Messaging OAuth token. */
  accessToken(): Promise<string | null>;
  /** Recheck delivery policy and the current recipient/device binding here. */
  resolveDestination(job: NotificationEnvelope): Promise<string | null>;
  request?: typeof fetch;
  now?: () => number;
  /** Controlled test budget; live providers always use the five-second cap. */
  timeoutMs?: number;
}>;

export function validFcmRegistrationToken(value: unknown): value is string {
  return typeof value === "string" && /^[!-~]{1,4096}$/.test(value);
}

/** A bounded wait around EVERY asynchronous provider stage, not only fetch.
 * A slow OAuth signer/device lookup must never keep the API call pending
 * indefinitely, nor be permitted to trigger an FCM send after expiry.
 * The supplied Promise may still settle later; only this continuation stops.
 */
async function withinBudget<T>(work: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error("FCM provider deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("FCM provider deadline")), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Android data-only delivery. A provider acknowledgement means accepted
 * for delivery. The device must fetch the current event under its own session.
 */
export function createFcmProvider(deps: FcmProviderDependencies): NotificationProvider {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(deps.projectId)) {
    throw new Error("Invalid FCM project configuration");
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${deps.projectId}/messages:send`;
  const request = deps.request ?? fetch;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? NOTIFICATION_PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > NOTIFICATION_PROVIDER_TIMEOUT_MS) {
    throw new Error("Invalid FCM provider deadline");
  }

  return {
    async send(job) {
      if (!validOpaqueId(job.eventId) || !/^[a-z][a-z_]{1,31}$/.test(job.eventType) ||
          !Number.isSafeInteger(job.expiresAtMs) || job.expiresAtMs <= now()) return "permanent";

      // The server event deadline uses the injected wall clock. The
      // transport budget uses a monotonic clock so a frozen/test clock or
      // system-time correction cannot extend an in-flight provider request.
      const started = performance.now();
      const remainingBudget = () => Math.max(0,
        Math.floor(timeoutMs - (performance.now() - started)));
      try {
        const accessToken = await withinBudget(
          Promise.resolve().then(deps.accessToken), remainingBudget());
        if (accessToken === null || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(accessToken)) {
          return "transient";
        }
        const registrationToken = await withinBudget(
          Promise.resolve().then(() => deps.resolveDestination(job)), remainingBudget());
        if (!validFcmRegistrationToken(registrationToken)) {
          return "permanent";
        }

        const sendAt = now();
        const remaining = remainingBudget();
        if (job.expiresAtMs <= sendAt) return "permanent";
        const ttl = Math.floor((job.expiresAtMs - sendAt) / 1000);
        if (remaining <= 0) return "transient";

        const response = await withinBudget(Promise.resolve().then(() => request(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(remaining),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: registrationToken,
              android: {
                ttl: `${Math.min(ttl, 2_419_200)}s`,
                ...(job.eventType === "call_ring"
                  ? {priority: "HIGH", restricted_package_name: "com.rekixo.jodlo"}
                  : {}),
              },
              data: {
                eventId: job.eventId,
                eventType: job.eventType,
                expiresAtMs: String(job.expiresAtMs),
              },
            },
          }),
        })), remaining);
        void response.body?.cancel().catch(() => {});
        if (response.status === 200) return "accepted";
        if (response.status === 401 || response.status === 408 || response.status === 429 ||
            response.status >= 500) return "transient";
        return "permanent";
      } catch {
        return "transient";
      }
    },
  };
}
