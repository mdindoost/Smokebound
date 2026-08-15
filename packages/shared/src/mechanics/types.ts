/**
 * Typed shape of `mechanics_config` (ARCHITECTURE §3).
 *
 * Every gameplay number in MECHANICS.md is addressed by a dotted key. The DB key
 * and the TypeScript key are literally the same string, so there is no mapping
 * layer that can drift.
 *
 * NOTE: this file declares *types only*. The values live in `defaults.ts`, which
 * is the one and only place a gameplay number may appear in source
 * (ARCHITECTURE §10: "any gameplay number found hardcoded outside
 * `mechanics_config` seeding is a bug").
 */

/** Launch-region bounding box, MECHANICS §1. */
export interface GridBBox {
  readonly min_lat: number;
  readonly max_lat: number;
  readonly min_lng: number;
  readonly max_lng: number;
}

/**
 * NWS forecast conditions collapsed to the buckets MECHANICS §2.1 prices.
 * `unknown` is the fail-open bucket (MECHANICS §2.1, REDTEAM F4).
 */
export type WeatherCondition =
  | 'clear'
  | 'few_clouds'
  | 'overcast'
  | 'fog'
  | 'mist'
  | 'drizzle'
  | 'light_rain'
  | 'snow'
  | 'heavy_rain'
  | 'thunderstorm'
  | 'unknown';

export type WeatherTimeMultTable = Readonly<Record<WeatherCondition, number>>;

/**
 * The complete gameplay configuration. Keys are the primary keys of
 * `mechanics_config`; values are the jsonb payloads.
 */
export interface MechanicsValues {
  // --- MECHANICS §1 · the grid -------------------------------------------
  /** Cell edge length in km. Structural: changing it invalidates every stored cell id. */
  'grid.cell_km': number;
  /** CONUS launch bbox. Structural, same caveat as `grid.cell_km`. */
  'grid.bbox': GridBBox;
  /** Extra ring of cells fetched around an in-flight route's bbox. */
  'grid.prefetch_padding_cells': number;

  // --- MECHANICS §1, §2.1, §9 · weather ----------------------------------
  'weather.cache_ttl_minutes': number;
  /** Degraded TTL used when NWS throttles us (MECHANICS §9). */
  'weather.degraded_cache_ttl_minutes': number;
  /** Beyond this multiple of the TTL a cell is treated as `weather_unknown`. */
  'weather.stale_ttl_multiplier_unknown': number;
  /**
   * Fail-open multiplier for a cell NWS has nothing for (REDTEAM F4).
   *
   * Stranding semantics only: unknown weather is never impassable. What a
   * *never-fetched* cell costs the router is `routing.unknown_cost_mult` — a
   * separate question, split out in REDTEAM F29.
   */
  'weather.unknown_time_mult': number;
  'weather.time_mult': WeatherTimeMultTable;
  /** Only an active NWS severe warning/watch makes a cell impassable (REDTEAM F2). */
  'weather.severe_alert_impassable': boolean;

  /**
   * Edge cost for a cell we have never fetched (REDTEAM F29).
   *
   * At 1.0 the unexplored sky was the cheapest terrain in the graph and A* had a
   * positive reason to fly through it. Priced like overcast, it stays crossable
   * and stops being inviting.
   */
  'routing.unknown_cost_mult': number;
  /** Wall-clock ceiling on resolving unknown cells before a preview (REDTEAM F28). */
  'preview.resolve_budget_seconds': number;

  // --- MECHANICS-V2 §2, §3 · the sun --------------------------------------
  /**
   * The night traversal mechanic (MECHANICS-V2 §2). Default **off**.
   *
   * Separate from `night.visuals_enabled` on purpose (REDTEAM F32): the map may
   * be honest about what the sky looks like long before we switch on a
   * multiplier. What this flag gates is the *claim* that fire is faster.
   */
  'night.enabled': boolean;
  /** Fire-at-night rendering. Theater only, default **on** (REDTEAM F32). */
  'night.visuals_enabled': boolean;
  /** Traversal multiplier for a hop entered at night in clear air. */
  'night.time_mult': number;
  /** Solar elevation below which it is night. −6° = civil twilight. */
  'night.twilight_elevation_deg': number;
  /**
   * Conditions in which a fire cannot be seen at range, so night confers no
   * bonus (MECHANICS-V2 §3.2). An explicit list rather than a threshold on
   * `time_mult`, because visibility and speed are different axes and fog proves
   * it: 1.6× time, and the worst possible seeing.
   */
  'night.blinding_conditions': WeatherCondition[];
  /**
   * Gale garble rolls only on hops entered in daylight (MECHANICS-V2 §3.1).
   *
   * Integrity is information: wind shreds the *shape* of a smoke column, and a
   * fire's meaning is its presence, so darkness is immunity. Speed is a separate
   * axis — `wind_mult` applies in both regimes, always (REDTEAM F33).
   */
  'garble.daylight_only': boolean;

  // --- MECHANICS §7.1 · the walk-over suggestion --------------------------
  /** Longest walk we would ever suggest instead of sending. */
  'proximity.walk_suggest_max_minutes': number;
  /** Shortest delivery that makes walking worth mentioning at all. */
  'proximity.walk_suggest_min_delivery_minutes': number;

  // --- MECHANICS-V2 §5 · counsel -----------------------------------------
  'counsel.enabled': boolean;
  /** Hours from now to evaluate as candidate departures. */
  'counsel.candidate_offsets_hours': number[];
  /** Also evaluate the next dusk and dawn *at the origin* (REDTEAM F37). */
  'counsel.include_dusk_dawn': boolean;
  /** Below this share of the route having hourly forecasts, counsel says nothing. */
  'counsel.min_forecast_coverage': number;
  /** Counsel stays quiet below this absolute saving (REDTEAM F38). */
  'counsel.min_abs_minutes': number;
  /** …or below this fraction of the send-now ETA (REDTEAM F38). */
  'counsel.min_fraction': number;
  'forecast.cache_ttl_minutes': number;
  'forecast.horizon_hours': number;

  // --- REDTEAM F30 · how much certainty a preview claims ------------------
  'preview.band_base_spread': number;
  'preview.band_unknown_spread': number;
  'preview.band_length_spread': number;
  'preview.band_length_half_life_hours': number;

  // --- REDTEAM F31 · background weather warming --------------------------
  'warming.interval_minutes': number;
  /** Ceiling on cells fetched per warming pass, across all priorities. */
  'warming.cells_per_pass': number;
  /** How recently a user must have been seen for their fire to be kept warm. */
  'warming.active_user_days': number;

  // --- MECHANICS §2 · speed ----------------------------------------------
  /**
   * @deprecated Display copy only. `speed.base_kmh` is canonical (REDTEAM F12);
   * no computation may read this key.
   */
  'speed.base_mph': number;
  /** Canonical base speed. Every duration in the system derives from this. */
  'speed.base_kmh': number;
  /** Walking estimate for the proximity footnote (MECHANICS §7.1). */
  'speed.walking_mph': number;

  // --- MECHANICS §2.2 · wind ---------------------------------------------
  'wind.tailwind_coefficient_per_mph': number;
  'wind.tailwind_min_mult': number;
  'wind.headwind_coefficient_per_mph': number;
  'wind.headwind_max_mult': number;
  'wind.gale_threshold_mph': number;

  // --- MECHANICS §3 · transmission ---------------------------------------
  'transmission.seconds_per_puff': number;
  'transmission.chars_per_puff': number;

  // --- MECHANICS §5 · message constraints --------------------------------
  'message.char_cap': number;

  // --- MECHANICS §4 · routing & cron cadence (ARCHITECTURE §6.2, §6.3) ----
  'routing.diagonal_distance_multiplier': number;
  /** Heuristic divides by `base_speed / factor` to stay admissible (REDTEAM F3). */
  'routing.heuristic_max_speed_factor': number;
  'routing.replan_interval_minutes': number;
  'routing.delivery_check_interval_minutes': number;
  'routing.dissipation_check_interval_hours': number;

  // --- MECHANICS §7B · delivery floor ------------------------------------
  'delivery.min_floor_minutes': number;

  // --- ARCHITECTURE §6.4 · preview/send contract -------------------------
  /** How long a preview's quoted route stays quotable. */
  'preview.token_ttl_minutes': number;
  /** ETA shift between preview and send that the user must be warned about. */
  'preview.eta_shift_warn_fraction': number;

  // --- MECHANICS §6.1 · stranding & dissipation --------------------------
  'stranded.grace_hours': number;
  'stranded.dissipation_chance_per_day': number;

  // --- MECHANICS §6.2 · garble -------------------------------------------
  'garble.gale_chance': number;
  'garble.min_fraction': number;
  'garble.max_fraction': number;
  /** Hard legibility ceiling: never garble more than this fraction. */
  'garble.legibility_cap_fraction': number;

  // --- MECHANICS §4 · relays (v1.1, seeded now so beta can tune early) ----
  'relay.active_window_hours': number;
  'relay.mult': number;
  'relay.tend_window_minutes': number;
  'relay.tend_mult': number;

  // --- The Keeper (SPEC §3, ARCHITECTURE §6.3, REDTEAM F5) ---------------
  'keeper.offset_cells': number;
  'keeper.reply_delay_minutes': number;
  'keeper.expected_delivery_minutes_min': number;
  'keeper.expected_delivery_minutes_max': number;

  // --- ARCHITECTURE §8 · abuse limits ------------------------------------
  'limits.sends_per_user_per_day': number;
  'limits.pending_flock_requests_outbound': number;

  // --- MECHANICS §7.1 · proximity (v1.1) ---------------------------------
  'proximity.come_to_fire_waives_floor': boolean;
}

export type MechanicsKey = keyof MechanicsValues;

/** One row of `mechanics_config` as stored in Postgres. */
export interface MechanicsConfigRow {
  key: string;
  value: unknown;
  updated_at?: string;
}

/** Provenance for a single tunable, carried in source only (not in the DB). */
export interface MechanicsEntryMeta {
  /** Marked TUNE in MECHANICS.md — expected to change during beta. */
  readonly tune: boolean;
  /** Document + section this number is defined by. */
  readonly source: string;
  readonly note?: string;
  /** Still seeded for display code, but no computation may read it. */
  readonly deprecated?: boolean;
}

export type MechanicsSpec = {
  readonly [K in MechanicsKey]: MechanicsEntryMeta & { readonly value: MechanicsValues[K] };
};
