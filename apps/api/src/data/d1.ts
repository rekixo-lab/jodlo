/** Small D1 contract shared by catalog + account/worker modules and local SQLite fakes. */
export type DbScalar = string | number | null;

export interface DbStatement {
  bind(...values: DbScalar[]): DbStatement;
  all<Row>(): Promise<{ results: Row[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): DbStatement;
}

/** This adapter MUST verify the credential server-side and return a JODLO internal account ID.
 * No implementation is bundled/deployed until M-002 is chosen. NEVER trust a client-supplied
 * account ID, X-User-ID header, bearer payload, or phone number as identity.
 */
export interface IdentityVerifier {
  verify(token: string): Promise<{ accountId: string } | null>;
}

export interface Env {
  DB?: D1Database;
  AUTH?: IdentityVerifier;
}
