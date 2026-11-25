/** Versioned implementation contract, NOT an owner's release approval.
 * Production remains closed until the reviewed policy document's SHA-256 is
 * configured separately. No price, refund clawback or operator approval is
 * inferred from this source constant or a client request.
 */
export const JODLO_PLAY_SETTLEMENT_POLICY_VERSION = "jodlo-play-minutes-v1";

export type PlaySettlementAuthority = Readonly<{
  sessionHash: string;
  policyVersion: string;
  approvalSha256: string;
  purchasedAtMs: number;
}>;

export function validPlaySettlementAuthority(value: PlaySettlementAuthority): boolean {
  return !!value && /^[a-f0-9]{64}$/.test(value.sessionHash) &&
    value.policyVersion === JODLO_PLAY_SETTLEMENT_POLICY_VERSION &&
    /^[a-f0-9]{64}$/.test(value.approvalSha256) &&
    value.approvalSha256 !== "0".repeat(64) &&
    Number.isSafeInteger(value.purchasedAtMs) && value.purchasedAtMs > 0;
}
