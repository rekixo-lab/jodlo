/** Narrow opaque, server-owned IDs. No human names, phone, Google sub or GPS. */
export function validOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[-_a-zA-Z0-9]{8,128}$/.test(value);
}

/** Public taxonomy IDs are separate from account IDs; categories may use short IDs. */
export function validCategoryId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

/** Client retry key is a *correlation key*, never a credential or user identifier. */
export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}
