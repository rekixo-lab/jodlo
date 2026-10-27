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
  DB?: D1Database;
  LOGIN_BURST_LIMITER?: RateLimitBinding;
  ACCOUNT_LOGIN_LIMITER?: RateLimitBinding;
  /** Public OAuth web/server client ID. Set only after owner-controlled Google configuration. */
  GOOGLE_CLIENT_ID?: string;
  /** Existing fake test port; production Worker uses the D1-backed session verifier. */
  AUTH?: IdentityVerifier;
}
