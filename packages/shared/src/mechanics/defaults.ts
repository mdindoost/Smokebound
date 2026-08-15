/**
 * ============================================================================
 * THE ONLY FILE IN THIS REPO ALLOWED TO CONTAIN A GAMEPLAY NUMBER.
 * ============================================================================
 *
 * ARCHITECTURE §10: "any gameplay number found hardcoded outside
 * `mechanics_config` seeding is a bug."
 *
 * This module is that seeding source. `services/engine` writes these rows into
 * `mechanics_config`; runtime code then reads the *table*, never this file
 * (see `config.ts` — the loader deliberately has no fallback to these values).
 *
 * The only exception is grid geometry (`grid.cell_km`, `grid.bbox`), which the
 * cell-math module reads at compile time because cell ids are persisted
 * identifiers: changing the grid is a migration, not a tuning knob. The engine
 * asserts DB and code agree at startup via `assertGridMatchesConfig()`.
 *
 * A guard test (`no-hardcoded-numbers.test.ts`) fails the build if any of these
 * literals reappears elsewhere in the source tree.
 */

import type { MechanicsKey, MechanicsSpec, MechanicsValues } from './types.js';

export const MECHANICS_SPEC = {
  // --- MECHANICS §1 · the grid -------------------------------------------
  'grid.cell_km': {
    value: 50,
    tune: false,
    source: 'MECHANICS §1',
    note: 'Structural. Changing this invalidates every persisted cell id.',
  },
  'grid.bbox': {
    value: { min_lat: 24, max_lat: 49.5, min_lng: -125, max_lng: -66 },
    tune: false,
    source: 'MECHANICS §1',
    note: 'CONUS launch region. Structural, same caveat as grid.cell_km.',
  },
  'grid.prefetch_padding_cells': {
    value: 1,
    tune: false,
    source: 'MECHANICS §1',
    note: 'Lazy weather fetch: route bbox + 1 cell padding.',
  },

  // --- MECHANICS §1, §2.1, §9 · weather ----------------------------------
  'weather.cache_ttl_minutes': { value: 30, tune: true, source: 'MECHANICS §1' },
  'weather.degraded_cache_ttl_minutes': {
    value: 60,
    tune: true,
    source: 'MECHANICS §9',
    note: 'Fallback TTL if NWS throttles us.',
  },
  'weather.stale_ttl_multiplier_unknown': {
    value: 2,
    tune: false,
    source: 'MECHANICS §2.1',
    note: 'Stale beyond 2×TTL => weather_unknown, treated as clear.',
  },
  'routing.unknown_cost_mult': {
    value: 1.15,
    tune: true,
    source: 'REDTEAM F29',
    note:
      'Edge cost for a cell we have never fetched. Distinct from ' +
      'weather.unknown_time_mult, which is the fail-open *stranding* rule: unknown ' +
      'is never impassable. This key answers a different question the fail-open ' +
      'rule was never asked — whether A* should PREFER the unexplored. At 1.0 it ' +
      'did, which is why a preview had to buy the whole corridor before it dared ' +
      'quote. Priced like overcast, the router routes through sky it understands.',
  },
  'preview.resolve_budget_seconds': {
    value: 10,
    tune: true,
    source: 'REDTEAM F28',
    note:
      'Hard wall-clock budget for resolving unknown cells on a candidate route. ' +
      'Whatever is still unknown when it expires is priced at ' +
      'routing.unknown_cost_mult and the preview returns. A person is waiting.',
  },

  // --- MECHANICS-V2 §2, §3 · the sun (REDTEAM F32–F36) --------------------
  'night.enabled': {
    value: false,
    tune: true,
    source: 'MECHANICS-V2 §2, §6',
    note: 'Night traversal. Off for the beta baseline week; see the §6.2 flip sequence.',
  },
  'night.visuals_enabled': {
    value: true,
    tune: true,
    source: 'REDTEAM F32',
    note:
      'Fire-at-night on the map. Default ON: theater is always honest about what the ' +
      'sky looks like. No copy may claim SPEED unless night.enabled is also true.',
  },
  'night.time_mult': {
    value: 0.75,
    tune: true,
    source: 'MECHANICS-V2 §2.1',
    note: 'A fire carries further than smoke, so the relay chain moves faster after dark.',
  },
  'night.twilight_elevation_deg': {
    value: -6.0,
    tune: true,
    source: 'MECHANICS-V2 §1.1',
    note:
      'Civil twilight. Sunset (0) is too early — smoke still reads for half an hour ' +
      'after — and nautical (-12) is too late, by which point it has plainly been dark.',
  },
  'night.blinding_conditions': {
    value: ['fog', 'mist', 'snow', 'heavy_rain', 'thunderstorm'],
    tune: true,
    source: 'MECHANICS-V2 §3.2, REDTEAM F35',
    note:
      'No night bonus: a fire cannot be seen at range through these. A list, not a ' +
      'threshold on time_mult — fog costs only 1.6x yet blinds completely, so ' +
      'visibility and speed are different axes. Snow stays undivided (F35): NWS text ' +
      'does not reliably separate flurries from heavy, and a list an operator can ' +
      'explain beats a distinction the data cannot support.',
  },
  'garble.daylight_only': {
    value: false,
    tune: true,
    source: 'MECHANICS-V2 §3.1, REDTEAM F33',
    note: 'Wind shreds a smoke column\'s shape; it cannot shred a stationary light.',
  },

  // --- MECHANICS §7.1 · the walk-over suggestion --------------------------
  'proximity.walk_suggest_max_minutes': {
    value: 60,
    tune: true,
    source: 'MECHANICS §7.1',
    note:
      'Only suggest walking when the walk is genuinely short. Seen on a device: ' +
      'the line offered a 10.4-hour walk against a 2.5-hour flight.',
  },
  'proximity.walk_suggest_min_delivery_minutes': {
    value: 60,
    tune: true,
    source: 'MECHANICS §7.1',
    note:
      '…and only when the smoke is genuinely slow. Both conditions, not just ' +
      '"walking wins": a 55-minute walk beating a 58-minute flight is a true ' +
      'statement and useless advice.',
  },

  // --- MECHANICS-V2 §5 · counsel (REDTEAM F37, F38, F42) ------------------
  'counsel.enabled': {
    value: false,
    tune: true,
    source: 'MECHANICS-V2 §5',
    note: 'Advisory only. Counsel never delays a send; the player lights the fire.',
  },
  'counsel.candidate_offsets_hours': {
    value: [0, 2, 4],
    tune: true,
    source: 'MECHANICS-V2 §5.2',
    note: 'Departure times to compare, in hours from now.',
  },
  'counsel.include_dusk_dawn': {
    value: true,
    tune: true,
    source: 'REDTEAM F37',
    note: 'Dusk and dawn AT THE ORIGIN — the sender\'s own sky, the one out the window.',
  },
  'counsel.min_forecast_coverage': {
    value: 0.8,
    tune: true,
    source: 'MECHANICS-V2 §5.4',
    note:
      'Counsel reads only cached hourly forecasts and never blocks. Below this ' +
      'coverage it says nothing at all — no spinner, no partial advice.',
  },
  'counsel.min_abs_minutes': {
    value: 30,
    tune: true,
    source: 'REDTEAM F38',
    note: 'Counsel stays quiet below this saving.',
  },
  'counsel.min_fraction': {
    value: 0.05,
    tune: true,
    source: 'REDTEAM F38',
    note:
      '…or below this fraction of the send-now ETA. Makes counsel confident on short ' +
      'routes and silent on long ones by construction: you cannot outrun the planet.',
  },
  'forecast.cache_ttl_minutes': {
    value: 60,
    tune: true,
    source: 'MECHANICS-V2 §5.3',
    note: 'NWS regenerates hourly forecasts about hourly.',
  },
  'forecast.horizon_hours': {
    value: 156,
    tune: true,
    source: 'MECHANICS-V2 §5.3',
    note: 'How far ahead hourly rows are kept. Bounds table growth with warmed cells.',
  },

  // --- REDTEAM F30 · how much certainty a preview claims -------------------
  'preview.band_base_spread': {
    value: 0.1,
    tune: true,
    source: 'REDTEAM F30',
    note: 'Narrowest a quoted band ever gets, as a fraction either side.',
  },
  'preview.band_unknown_spread': {
    value: 0.34,
    tune: true,
    source: 'REDTEAM F30',
    note: 'Extra spread when every cell on the route is one we never looked at.',
  },
  'preview.band_length_spread': {
    value: 0.15,
    tune: true,
    source: 'REDTEAM F30',
    note: 'Extra spread approached asymptotically as journeys get long.',
  },
  'preview.band_length_half_life_hours': {
    value: 24,
    tune: true,
    source: 'REDTEAM F30',
    note: 'Journey length at which length-driven spread reaches half its maximum.',
  },

  // --- REDTEAM F31 · keeping the sky warm in the background ---------------
  'warming.interval_minutes': {
    value: 5,
    tune: true,
    source: 'REDTEAM F31',
    note: 'How often the warming pass runs. Never a full-grid sweep.',
  },
  'warming.cells_per_pass': {
    value: 400,
    tune: true,
    source: 'REDTEAM F31',
    note:
      'Ceiling on cells fetched per pass, across all priorities. Bounds both NWS ' +
      'traffic and the time a pass can hold the fetcher.',
  },
  'warming.active_user_days': {
    value: 7,
    tune: true,
    source: 'REDTEAM F31',
    note: 'A fire is worth keeping warm if its owner has been seen this recently.',
  },

  'weather.unknown_time_mult': {
    value: 1.0,
    tune: false,
    source: 'MECHANICS §2.1',
    note: 'Fail-open rule (REDTEAM F4). Never strand on missing data.',
  },
  'weather.time_mult': {
    value: {
      clear: 1.0,
      few_clouds: 1.0,
      overcast: 1.15,
      fog: 1.6,
      mist: 1.6,
      drizzle: 2.0,
      light_rain: 2.0,
      snow: 2.5,
      heavy_rain: 4.0,
      thunderstorm: 6.0,
      unknown: 1.0,
    },
    tune: true,
    source: 'MECHANICS §2.1',
    note: 'Time multipliers, higher = slower.',
  },
  'weather.severe_alert_impassable': {
    value: true,
    tune: false,
    source: 'MECHANICS §2.1 / REDTEAM F2',
    note: 'Impassable requires an ACTIVE NWS severe warning/watch, not a stormy forecast.',
  },

  // --- MECHANICS §2 · speed ----------------------------------------------
  'speed.base_mph': {
    value: 20,
    tune: false,
    deprecated: true,
    source: 'MECHANICS §2 / REDTEAM F12',
    note: 'UI flavor copy only ("20 mph"). Never compute from this — 20 mph is 32.19 km/h, not 32.',
  },
  'speed.base_kmh': {
    value: 32,
    tune: true,
    source: 'MECHANICS §2',
    note: 'Canonical base speed and the single most important number in the app (MECHANICS §8.1).',
  },
  'speed.walking_mph': {
    value: 3,
    tune: false,
    source: 'MECHANICS §7.1',
    note: 'Used only for the "on foot: Y min" delivery footnote.',
  },

  // --- MECHANICS §2.2 · wind ---------------------------------------------
  'wind.tailwind_coefficient_per_mph': { value: 0.01, tune: true, source: 'MECHANICS §2.2' },
  'wind.tailwind_min_mult': { value: 0.7, tune: true, source: 'MECHANICS §2.2' },
  'wind.headwind_coefficient_per_mph': { value: 0.015, tune: true, source: 'MECHANICS §2.2' },
  'wind.headwind_max_mult': { value: 1.6, tune: true, source: 'MECHANICS §2.2' },
  'wind.gale_threshold_mph': {
    value: 40,
    tune: true,
    source: 'MECHANICS §2.2',
    note: 'Sustained wind above this rolls garble on every traversal.',
  },

  // --- MECHANICS §3 · transmission ---------------------------------------
  'transmission.seconds_per_puff': {
    value: 3,
    tune: true,
    source: 'MECHANICS §3',
    note: 'transmission_time = seconds_per_puff × ceil(chars / chars_per_puff).',
  },
  'transmission.chars_per_puff': { value: 4, tune: true, source: 'MECHANICS §3' },

  // --- MECHANICS §5 · message constraints --------------------------------
  'message.char_cap': {
    value: 280,
    tune: false,
    source: 'MECHANICS §5',
    note: 'Mirrored as a CHECK constraint on messages.body — see migration 0001.',
  },

  // --- MECHANICS §4 · routing & cron cadence -----------------------------
  'routing.diagonal_distance_multiplier': {
    value: 1.414,
    tune: false,
    source: 'ARCHITECTURE §6.2',
  },
  'routing.heuristic_max_speed_factor': {
    value: 0.7,
    tune: false,
    source: 'ARCHITECTURE §6.2 / REDTEAM F3',
    note: 'Heuristic divides by base_speed / 0.7 (max tailwind speed) to stay admissible.',
  },
  'routing.replan_interval_minutes': { value: 15, tune: true, source: 'MECHANICS §4' },
  'routing.delivery_check_interval_minutes': { value: 1, tune: false, source: 'ARCHITECTURE §6.3' },
  'routing.dissipation_check_interval_hours': { value: 1, tune: false, source: 'ARCHITECTURE §6.3' },

  // --- MECHANICS §7B · delivery floor ------------------------------------
  'delivery.min_floor_minutes': {
    value: 10,
    tune: true,
    source: 'MECHANICS §7B',
    note: 'Never instant; anticipation is the product.',
  },

  // --- ARCHITECTURE §6.4 · preview/send contract -------------------------
  'preview.token_ttl_minutes': {
    value: 10,
    tune: false,
    source: 'ARCHITECTURE §6.4 / REDTEAM F18',
    note: 'A quoted route older than this is recomputed silently.',
  },
  'preview.eta_shift_warn_fraction': {
    value: 0.2,
    tune: true,
    source: 'ARCHITECTURE §6.4',
    note: 'Warn the sender when the recomputed ETA differs from the preview by more than this.',
  },

  // --- MECHANICS §6.1 · stranding & dissipation --------------------------
  'stranded.grace_hours': { value: 24, tune: false, source: 'MECHANICS §6.1' },
  'stranded.dissipation_chance_per_day': {
    value: 0.05,
    tune: true,
    source: 'MECHANICS §6.1',
    note: 'Keep rare: losing messages must be memorable, not routine.',
  },

  // --- MECHANICS §6.2 · garble -------------------------------------------
  'garble.gale_chance': { value: 0.35, tune: true, source: 'MECHANICS §6.2' },
  'garble.min_fraction': { value: 0.03, tune: true, source: 'MECHANICS §6.2' },
  'garble.max_fraction': { value: 0.1, tune: true, source: 'MECHANICS §6.2' },
  'garble.legibility_cap_fraction': {
    value: 0.1,
    tune: false,
    source: 'MECHANICS §6.2',
    note: 'Never garble below legibility: hard ceiling of 10% of grapheme clusters.',
  },

  // --- MECHANICS §4 · relays (v1.1) --------------------------------------
  'relay.active_window_hours': { value: 24, tune: true, source: 'MECHANICS §4 (v1.1)' },
  'relay.mult': { value: 0.5, tune: true, source: 'MECHANICS §4 (v1.1)' },
  'relay.tend_window_minutes': { value: 30, tune: true, source: 'MECHANICS §4 (v1.1)' },
  'relay.tend_mult': { value: 0.1, tune: true, source: 'MECHANICS §4 (v1.1)' },

  // --- The Keeper (SPEC §3, ARCHITECTURE §6.3, REDTEAM F5) ---------------
  'keeper.offset_cells': {
    value: 1,
    tune: false,
    source: 'SPEC §3 / REDTEAM F5',
    note: "The Keeper's fire sits one cell from each new user.",
  },
  'keeper.reply_delay_minutes': { value: 30, tune: true, source: 'ARCHITECTURE §6.3' },
  'keeper.expected_delivery_minutes_min': { value: 10, tune: false, source: 'REDTEAM F5' },
  'keeper.expected_delivery_minutes_max': { value: 60, tune: false, source: 'REDTEAM F5' },

  // --- ARCHITECTURE §8 · abuse limits ------------------------------------
  'limits.sends_per_user_per_day': { value: 30, tune: true, source: 'ARCHITECTURE §8' },
  'limits.pending_flock_requests_outbound': { value: 5, tune: true, source: 'ARCHITECTURE §8' },

  // --- MECHANICS §7.1 · proximity (v1.1) ---------------------------------
  'proximity.come_to_fire_waives_floor': {
    value: true,
    tune: true,
    source: 'MECHANICS §7.1 (v1.1)',
  },
} as const satisfies MechanicsSpec;

/** Every key that must exist in `mechanics_config`, in seeding order. */
export const MECHANICS_KEYS = Object.keys(MECHANICS_SPEC) as MechanicsKey[];

/** Flat `{key: value}` view — exactly what gets written to `mechanics_config`. */
export const MECHANICS_DEFAULTS: MechanicsValues = Object.fromEntries(
  MECHANICS_KEYS.map((key) => [key, MECHANICS_SPEC[key].value]),
) as unknown as MechanicsValues;

/** Rows ready for `upsert` into `mechanics_config` (ARCHITECTURE §3). */
export function mechanicsSeedRows(): { key: MechanicsKey; value: unknown }[] {
  return MECHANICS_KEYS.map((key) => ({ key, value: MECHANICS_SPEC[key].value }));
}
