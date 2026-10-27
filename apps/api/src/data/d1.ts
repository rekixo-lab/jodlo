/** Narrow D1 interface: enough for catalog reads, easy to fake without Cloudflare SDK. */
export interface CatalogDatabase {
  prepare(query: string): {
    bind(...values: Array<string | number | null>): {
      all<Row>(): Promise<{ results: Row[] }>;
    };
  };
}

export interface Env {
  /** Optional until a local or approved production D1 binding exists. */
  DB?: CatalogDatabase;
}
