/**
 * Engine entry point.
 *
 *   npm start -w services/engine
 *
 * Loads `mechanics_config` from the database (never from compiled defaults —
 * ARCHITECTURE §10), asserts the invariants that would otherwise fail silently
 * (REDTEAM F19), then starts the crons and whichever transports are configured.
 */

import { MechanicsConfig } from '@smoke/shared';
import { Client } from 'pg';

import { pgExecutor } from './db/executor.js';
import type { SqlExecutor } from './db/executor.js';
import { loadEnvFiles, requireEnv } from './engine/env.js';
import { createEngineContext } from './engine/context.js';
import { startCrons } from './crons/scheduler.js';
import { KEEPER_ID } from './messages/keeper.js';
import { WeatherCache } from './weather/cache.js';
import { ForecastStore } from './weather/forecast.js';
import { HttpNwsClient } from './weather/nws.js';
import { SqlWeatherStore } from './weather/store.js';
import { parseTransportMode, startTransports } from './transport/index.js';

async function loadConfig(db: SqlExecutor): Promise<MechanicsConfig> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    'select key, value from public.mechanics_config',
  );
  return MechanicsConfig.fromRows(rows);
}

async function main(): Promise<void> {
  const log = (message: string): void => {
    console.log(`[${new Date().toISOString()}] ${message}`);
  };

  for (const file of loadEnvFiles()) log(`loaded ${file}`);

  const client = new Client({ connectionString: requireEnv('DATABASE_URL') });
  await client.connect();
  const db = pgExecutor(client);

  const config = await loadConfig(db);
  const weather = new WeatherCache({
    client: new HttpNwsClient({
      userAgent: process.env['NWS_USER_AGENT'] ?? '(smoke, contact@example.com)',
    }),
    store: new SqlWeatherStore(db),
    config,
    log,
  });

  const ctx = createEngineContext({
    db,
    config,
    weather,
    previewSecret: requireEnv('PREVIEW_TOKEN_SECRET'),
    keeperId: KEEPER_ID,
    log,
  });

  const mode = parseTransportMode(process.env['ENGINE_TRANSPORT']);
  const transports = await startTransports(ctx, {
    mode,
    http:
      mode === 'http' || mode === 'both'
        ? {
            jwtSecret: requireEnv('SUPABASE_JWT_SECRET'),
            port: Number(process.env['PORT'] ?? 8787),
            host: process.env['HOST'] ?? '0.0.0.0',
          }
        : undefined,
  });

  const forecasts = new ForecastStore(
    db,
    config,
    new HttpNwsClient({
      userAgent: process.env['NWS_USER_AGENT'] ?? '(smoke, contact@example.com)',
    }),
    () => new Date(),
    log,
  );

  const crons = startCrons(ctx, { forecasts });
  log(`engine up (transport: ${mode})`);

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    crons.stop();
    await transports.stop();
    await client.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

await main();
