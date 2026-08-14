/**
 * @smoke/engine — routing + jobs service.
 *
 * M1: migrations and `mechanics_config` seeding.
 * M2: the weather cache (ARCHITECTURE §6.1) and the A* router (§6.2).
 * M3: send/preview endpoints, crons and the message state machine.
 */

export { applyMigrations, loadMigrations, MIGRATIONS_DIR, LOCAL_STUBS_DIR } from './db/migrations.js';
export type { Migration, MigrationResult } from './db/migrations.js';
export { pgExecutor } from './db/executor.js';
export type { PgLikeClient, QueryResult, SqlExecutor } from './db/executor.js';
export { seedMechanicsConfig } from './seed/mechanics.js';
export type { SeedOptions, SeedResult } from './seed/mechanics.js';

// --- M2: weather ------------------------------------------------------------
export { WeatherCache } from './weather/cache.js';
export type { WeatherCacheOptions, WeatherPassStats } from './weather/cache.js';
export { HttpNwsClient, NwsUnavailableError, isSevereAlert } from './weather/nws.js';
export type { NwsAlert, NwsClient, NwsForecast, HttpNwsClientOptions } from './weather/nws.js';
export { CONDITION_RULES, mapNwsCondition, parseWindDirection, parseWindSpeedMph } from './weather/conditions.js';
export { MemoryWeatherStore, SqlWeatherStore } from './weather/store.js';
export type { StoredWeather, WeatherStore } from './weather/store.js';
export { snapshotFrom } from './weather/types.js';
export type { CellWeather, WeatherSnapshot, WeatherSource } from './weather/types.js';

// --- M2: routing ------------------------------------------------------------
export { planRoute, toSegmentEtas } from './routing/astar.js';
export type {
  NoRoute,
  PlanRouteOptions,
  RouteFound,
  RouteResult,
  RouteWaypoint,
} from './routing/astar.js';
export { cellMultipliers, heuristicHours, hopDistanceKm, hopHours, windMultiplier } from './routing/cost.js';
