/** Small D1 contract reused across catalog, profiles and sign-in. */
export type DbScalar = string | number | null;

export interface DbStatement {
  bind(...values: DbScalar[]): DbStatement;
  all<Row>(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
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
export interface Env {
  DB?: D1Database;
  /** Public OAuth web/server client ID. Set only after owner-controlled Google configuration. */
  GOOGLE_CLIENT_ID?: string;
  /** Existing fake test port; production Worker uses the D1-backed session verifier. */
  AUTH?: IdentityVerifier;
}
