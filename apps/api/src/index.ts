import type { Env } from "./data/d1.ts";
import { handleRequest } from "./http/router.ts";

/** Cloudflare Worker entrypoint. D1 is bound only in isolated local configuration for now. */
export default {
  fetch(request: Request, env: Env = {}): Promise<Response> {
    return handleRequest(request, env);
  },
};
