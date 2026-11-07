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
}>;

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

  return {
    async send(job) {
      if (!validOpaqueId(job.eventId) || !/^[a-z][a-z_]{1,31}$/.test(job.eventType) ||
          !Number.isSafeInteger(job.expiresAtMs) || job.expiresAtMs <= now()) return "permanent";

      const deadline = now() + NOTIFICATION_PROVIDER_TIMEOUT_MS;
      try {
        const accessToken = await deps.accessToken();
        if (accessToken === null || !/^[A-Za-z0-9._~+\/-]{1,4096}={0,2}$/.test(accessToken)) {
          return "transient";
        }
        const registrationToken = await deps.resolveDestination(job);
        if (registrationToken === null || !/^[!-~]{1,4096}$/.test(registrationToken)) {
          return "permanent";
        }

        const sendAt = now();
        const remaining = deadline - sendAt;
        if (job.expiresAtMs <= sendAt) return "permanent";
        const ttl = Math.floor((job.expiresAtMs - sendAt) / 1000);
        if (remaining <= 0) return "transient";

        const response = await request(endpoint, {
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
              android: { ttl: `${Math.min(ttl, 2_419_200)}s` },
              data: {
                eventId: job.eventId,
                eventType: job.eventType,
                expiresAtMs: String(job.expiresAtMs),
              },
            },
          }),
        });
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
