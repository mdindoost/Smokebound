/**
 * The tiny database surface M1 needs.
 *
 * Both the migration runner and the seed script talk to this interface, so the
 * exact same code path runs against a hosted Supabase Postgres (via `pg`) and
 * against the in-process PGlite instance the tests use. "Migrations apply
 * cleanly" is therefore something the test suite can actually prove.
 */

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

export interface SqlExecutor {
  /** Run one or more statements. Implementations must not wrap in a transaction. */
  exec(sql: string): Promise<void>;
  /** Run a single parameterised statement. */
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

/** `pg`-backed executor. Kept dependency-light: any node-postgres client works. */
export interface PgLikeClient {
  query(config: { text: string; values?: unknown[] }): Promise<{ rows: unknown[] }>;
}

export function pgExecutor(client: PgLikeClient): SqlExecutor {
  return {
    async exec(sql: string): Promise<void> {
      await client.query({ text: sql });
    },
    async query<Row>(sql: string, params: unknown[] = []): Promise<QueryResult<Row>> {
      const result = await client.query({ text: sql, values: params });
      return { rows: result.rows as Row[] };
    },
  };
}
