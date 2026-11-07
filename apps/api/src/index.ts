import type { Env } from "./data/d1.ts";
import { handleRequest } from "./http/router.ts";
import { CALL_HISTORY_CLEANUP_CRON, purgeExpiredCallHistory } from "./modules/interactions/call-history.ts";
import { purgeExpiredCallAttemptWindows } from "./modules/interactions/call-attempt-windows.ts";

/** Cloudflare Worker entrypoint. Production D1 is migrated; production Worker code deployment requires verified owner action. */
export default {
  fetch(request: Request, env: Env = {}): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(event: {cron: string; scheduledTime: number}, env: Env): Promise<void> {
    if (event.cron === CALL_HISTORY_CLEANUP_CRON && env.DB) {
      await Promise.all([
        purgeExpiredCallHistory(env.DB, Math.floor(event.scheduledTime / 1000)),
        purgeExpiredCallAttemptWindows(env.DB, event.scheduledTime),
      ]);
    }
  },
};
