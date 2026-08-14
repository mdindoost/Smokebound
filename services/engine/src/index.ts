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

// --- M3: lifecycle ----------------------------------------------------------
export { createEngineContext } from './engine/context.js';
export type { EngineContext, CreateEngineContextOptions } from './engine/context.js';
export { systemClock, addHours, addMinutes, hoursBetween } from './engine/clock.js';
export type { Clock } from './engine/clock.js';
export { seededRng, systemRng, rollChance, uniform, hashSeed } from './engine/rng.js';
export type { Rng } from './engine/rng.js';
export { NoopPushDispatcher, RecordingPushDispatcher } from './engine/push.js';
export type { PushDispatcher, PushMessage } from './engine/push.js';
export {
  assertEngineInvariants,
  assertHeuristicAdmissible,
  minimumAchievableTimeMultiplier,
  ConfigInvariantError,
} from './engine/guards.js';

export { previewMessage, sendMessage, resendMessage } from './messages/send.js';
export type {
  PreviewRequest,
  PreviewResult,
  SendRequest,
  SendResult,
  EtaWarning,
  ProximityNote,
} from './messages/send.js';
export { EngineError } from './messages/errors.js';
export type { EngineErrorCode } from './messages/errors.js';
export { garbleText, graphemeCount, graphemes, transmissionSeconds } from './messages/text.js';
export { replayGarbles } from './messages/garbleLog.js';
export { planJourney, replanFrom } from './messages/planning.js';
export {
  KEEPER_ID,
  KEEPER_HANDLE,
  KEEPER_LINES,
  ensureKeeper,
  ensureKeeperFlock,
  keeperCellFor,
  nextKeeperLine,
} from './messages/keeper.js';
export { hashBody, signPreviewToken, verifyPreviewToken } from './messages/token.js';

export { runDeliveryCheck } from './crons/deliveryCheck.js';
export { runReplan } from './crons/replan.js';
export { runDissipation, perRunDissipationChance } from './crons/dissipation.js';
export { runKeeperReplies } from './crons/keeperReply.js';
export { startCrons, runAllCronsOnce } from './crons/scheduler.js';

export * from './transport/index.js';
export * as repo from './db/repo.js';

// --- test support (used by the engine's own tests and the app's e2e run) -----
export {
  createTestDatabase,
  createUser as createTestUser,
  createFlock as createTestFlock,
} from './testing/database.js';
export type { TestDatabase, SupabaseRole } from './testing/database.js';
