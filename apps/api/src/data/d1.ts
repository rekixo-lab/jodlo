/** Small D1 contract reused across catalog, profiles and sign-in. */
export type DbScalar = string | number | null;

export interface DbStatement {
  bind(...values: DbScalar[]): DbStatement;
  all<Row>(): Promise<{ results: Row[] }>;
  /** D1 meta.changes reports whether a conditional insert actually succeeded. */
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1Database {
  prepare(query: string): DbStatement;
  /** Cloudflare D1 executes batch atomically, preventing half-created identities. */
  batch(statements: DbStatement[]): Promise<unknown[]>;
}

/** Test-only/trusted adapter seam. Never trust client-supplied account or role headers. */
export interface IdentityVerifier {
  verify(token: string): Promise<{ accountId: string } | null>;
}
/** Cloudflare's approximate per-location rate-limit binding; locally simulated in CI. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Operator-only readiness/case workflow. Never bundled into Android. */
  OPERATIONS_ENABLED?: string;
  OPERATIONS_KEY?: string;
  OPERATIONS_LIMITER?: RateLimitBinding;
  BUILD_COMMIT_SHA?: string;
  /** Unset until account-erasure release. Server secret, 32 random bytes as hex. */
  ACCOUNT_ERASURE_RELEASE_KEY?: string;
  CONTACT_BLOCKS_ENABLED?: string;
  CALL_HISTORY_ENABLED?: string;
  CALL_DEVICES_ENABLED?: string;
  CALL_SIGNALING_ENABLED?: string;
  CALL_MEDIA_VERIFICATION_ENABLED?: string;
  AGORA_APP_CERTIFICATE?: string;
  /** Default OFF: operator-reviewed, provider-authenticated RTC usage policy. */
  CALL_USAGE_ENABLED?: string;
  CALL_USAGE_POLICY_VERSION?: string;
  CALL_USAGE_APPROVAL_SHA256?: string;
  AGORA_NOTIFICATIONS_SECRET?: string;
  CALL_USAGE_LIMITER?: RateLimitBinding;
  FCM_PROJECT_ID?: string;
  FCM_SERVICE_ACCOUNT_EMAIL?: string;
  FCM_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  SERVICE_MODERATION_KEY?: string;
  /** Default-OFF Google Play RTDN: requires ALL exact Pub/Sub identity, OAuth and rate-limit bindings. */
  /** Default-OFF read-only minute-pack preview. No checkout or credit route. */
  PLAY_CATALOG_ENABLED?: string;
  /** Default OFF: session-only read of D1 minute ledger with the shared pack catalog. */
  PLAY_ACCOUNT_VIEW_ENABLED?: string;
  /** OFF until backend/Play owner setup; read-only, rate-limited verification. */
  PLAY_VERIFICATION_ENABLED?: string;
  PLAY_VERIFICATION_LIMITER?: RateLimitBinding;
  /** Explicitly configured purchase settlement; no automatic release activation. */
  PLAY_SETTLEMENT_ENABLED?: string;
  PLAY_SETTLEMENT_POLICY_VERSION?: string;
  PLAY_SETTLEMENT_APPROVAL_SHA256?: string;
  PLAY_SETTLEMENT_LIMITER?: RateLimitBinding;
  PLAY_REFUND_HOLDS_ENABLED?: string;
  PLAY_REFUND_POLICY_VERSION?: string;
  PLAY_REFUND_APPROVAL_SHA256?: string;
  PLAY_RTDN_ENABLED?: string;
  PLAY_RTDN_AUDIENCE?: string;
  PLAY_RTDN_PUSH_EMAIL?: string;
  PLAY_RTDN_SUBSCRIPTION?: string;
  PLAY_SERVICE_ACCOUNT_EMAIL?: string;
  PLAY_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  PLAY_RTDN_LIMITER?: RateLimitBinding;
  DB?: D1Database;
  LOGIN_BURST_LIMITER?: RateLimitBinding;
  ACCOUNT_LOGIN_LIMITER?: RateLimitBinding;
  /** Public OAuth web/server client ID. Set only after owner-controlled Google configuration. */
  GOOGLE_CLIENT_ID?: string;
  /** JODLO Android OAuth client ID, allowed only as signed Google token `azp`. */
  GOOGLE_ANDROID_CLIENT_ID?: string;
  /** Existing fake test port; production Worker uses the D1-backed session verifier. */
  AUTH?: IdentityVerifier;
}
