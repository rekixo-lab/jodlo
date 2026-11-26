import type { Env } from "../../data/d1.ts";

export type PlayPurchaseEnvironment = "production" | "license_test";

/** Server-only policy. The secret stores 1–32 hashed JODLO account bindings,
 * never email addresses, Google subjects or raw JODLO account identifiers.
 * Missing/OFF configuration permits only real purchases. An enabled but
 * malformed configuration disables checkout instead of widening access. */
export function configuredPlayLicenseTestBindings(
  env: Pick<Env, "PLAY_LICENSE_TEST_ENABLED" | "PLAY_LICENSE_TEST_ACCOUNT_BINDINGS">,
): ReadonlySet<string> | null {
  if (env.PLAY_LICENSE_TEST_ENABLED === undefined || env.PLAY_LICENSE_TEST_ENABLED === "0")
    return new Set();
  if (env.PLAY_LICENSE_TEST_ENABLED !== "1") return null;
  const secret = env.PLAY_LICENSE_TEST_ACCOUNT_BINDINGS;
  if (typeof secret !== "string" || secret.length < 64 || secret.length > 32 * 65 - 1)
    return null;
  const values = secret.split(",");
  if (values.length < 1 || values.length > 32 || new Set(values).size !== values.length ||
      values.some(value => !/^[a-f0-9]{64}$/.test(value) || value === "0".repeat(64)))
    return null;
  return new Set(values);
}

/** Google's ProductPurchaseV2 test marker is provider evidence, not a client
 * option. Unknown test markers must never be interpreted as real payment. */
export function playPurchaseEnvironment(testPurchaseContext: unknown): PlayPurchaseEnvironment | null {
  if (testPurchaseContext === undefined) return "production";
  if (!testPurchaseContext || typeof testPurchaseContext !== "object" || Array.isArray(testPurchaseContext))
    return null;
  const context = testPurchaseContext as Record<string, unknown>;
  return context.fopType === "TEST" && Object.keys(context).length === 1 ? "license_test" : null;
}
