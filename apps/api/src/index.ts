import type { Env } from "./data/d1.ts";
import { handleRequest } from "./http/router.ts";

/** Cloudflare Worker entrypoint. Production D1 is migrated; production Worker code deployment requires verified owner action. */
export default {
  fetch(request: Request, env: Env = {}): Promise<Response> {
    return handleRequest(request, env);
  },
};
