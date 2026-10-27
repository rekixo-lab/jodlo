import { handleRequest } from "./http/router.ts";

/** Cloudflare Workers module entrypoint; no credentials or storage required. */
export default {
  fetch(request: Request): Response {
    return handleRequest(request);
  },
};
