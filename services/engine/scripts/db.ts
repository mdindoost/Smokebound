/**
 * Shared CLI plumbing: open a `pg` client against DATABASE_URL.
 *
 * For a hosted Supabase project the URL is in
 * Project Settings → Database → Connection string → URI.
 */

import { Client } from 'pg';

import { pgExecutor } from '../src/db/executor.js';
import type { SqlExecutor } from '../src/db/executor.js';

export interface Connection {
  db: SqlExecutor;
  close: () => Promise<void>;
  target: string;
}

export async function connect(): Promise<Connection> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        'Supabase: Project Settings → Database → Connection string → URI\n' +
        'Example: DATABASE_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"',
    );
  }

  const client = new Client({
    connectionString: url,
    // Supabase terminates TLS with a cert most local trust stores do not carry.
    ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  return {
    db: pgExecutor(client),
    close: () => client.end(),
    target: url.replace(/:\/\/[^@]*@/, '://***@'),
  };
}
