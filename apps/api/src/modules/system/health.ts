/** No build metadata or private vendor configuration leaves this endpoint. */
export function healthData(): { service: "jodlo-api"; status: "ok" } {
  return { service: "jodlo-api", status: "ok" };
}
