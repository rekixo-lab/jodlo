/**
 * Price-independent JODLO minute-pack contract, derived from the useful
 * duration sizes in Finworkar's old minute plans. Absolutely NO legacy
 * Razorpay amount, discount, marketing tag, wallet or payment secret is copied.
 *
 * Product IDs are JODLO proposals to create in Play Console at FINAL setup.
 * The read-only catalog is gated off by default, cannot authorize a payment
 * or mint minutes, and never treats a locally configured price as trusted.
 */
export const JODLO_PLAY_MINUTE_PACKS = Object.freeze(
  [5, 20, 50, 100, 300, 500].map(minutes => Object.freeze({
    productId: "jodlo.minutes" + minutes,
    minutes,
  })),
);

export type JodloPlayMinutePack = Readonly<{
  productId: string;
  minutes: number;
}>;

/** One canonical catalog; other internal Play logic may derive a map from
 * these IDs only after explicit owner-controlled launch authorization. */
export function jodloPlayMinuteProductMap(): ReadonlyMap<string, number> {
  return new Map(JODLO_PLAY_MINUTE_PACKS.map(({productId, minutes}) => [productId, minutes]));
}

/** No fake rupee price, order, entitlement, billing action or sale flag. */
export function priceIndependentPlayCatalog(): Readonly<{
  packs: readonly JodloPlayMinutePack[];
  priceSource: "google_play";
  purchasable: false;
}> {
  return {
    packs: JODLO_PLAY_MINUTE_PACKS,
    priceSource: "google_play",
    purchasable: false,
  };
}
