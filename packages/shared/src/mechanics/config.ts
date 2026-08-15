/**
 * Runtime access to `mechanics_config`.
 *
 * The loader is deliberately *strict and fallback-free*: if a key is missing
 * from the table the process fails loudly instead of silently substituting a
 * compiled-in default. That is what makes ARCHITECTURE §10 enforceable — there
 * is exactly one place a number can come from at runtime, and it is the DB.
 */

import { MECHANICS_KEYS } from './defaults.js';
import type {
  MechanicsConfigRow,
  MechanicsKey,
  MechanicsValues,
  WeatherCondition,
  WeatherTimeMultTable,
} from './types.js';

export class MechanicsConfigError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(`${message}\n  - ${problems.join('\n  - ')}`);
    this.name = 'MechanicsConfigError';
  }
}

const WEATHER_CONDITIONS: WeatherCondition[] = [
  'clear',
  'few_clouds',
  'overcast',
  'fog',
  'mist',
  'drizzle',
  'light_rain',
  'snow',
  'heavy_rain',
  'thunderstorm',
  'unknown',
];

type Validator = (value: unknown) => string | null;

const isFiniteNumber: Validator = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? null : 'expected a finite number';

const isBoolean: Validator = (v) => (typeof v === 'boolean' ? null : 'expected a boolean');

const isBBox: Validator = (v) => {
  if (typeof v !== 'object' || v === null) return 'expected an object';
  const o = v as Record<string, unknown>;
  for (const k of ['min_lat', 'max_lat', 'min_lng', 'max_lng']) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return `missing/invalid "${k}"`;
  }
  if ((o['min_lat'] as number) >= (o['max_lat'] as number)) return 'min_lat must be < max_lat';
  if ((o['min_lng'] as number) >= (o['max_lng'] as number)) return 'min_lng must be < max_lng';
  return null;
};

const isTimeMultTable: Validator = (v) => {
  if (typeof v !== 'object' || v === null) return 'expected an object';
  const o = v as Record<string, unknown>;
  const missing = WEATHER_CONDITIONS.filter((c) => typeof o[c] !== 'number');
  return missing.length ? `missing/invalid conditions: ${missing.join(', ')}` : null;
};

const isConditionList: Validator = (v) => {
  if (!Array.isArray(v)) return 'expected an array of weather conditions';
  const unknown = v.filter((c) => !WEATHER_CONDITIONS.includes(c as WeatherCondition));
  return unknown.length ? `not weather conditions: ${unknown.join(', ')}` : null;
};

const isNumberList: Validator = (v) => {
  if (!Array.isArray(v)) return 'expected an array of numbers';
  return v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? null
    : 'expected every entry to be a finite number';
};

/** Type-shape validators, one per key. Types only — never values. */
const VALIDATORS: Record<MechanicsKey, Validator> = {
  'grid.cell_km': isFiniteNumber,
  'grid.bbox': isBBox,
  'grid.prefetch_padding_cells': isFiniteNumber,
  'weather.cache_ttl_minutes': isFiniteNumber,
  'weather.degraded_cache_ttl_minutes': isFiniteNumber,
  'weather.stale_ttl_multiplier_unknown': isFiniteNumber,
  'weather.unknown_time_mult': isFiniteNumber,
  'weather.time_mult': isTimeMultTable,
  'weather.severe_alert_impassable': isBoolean,
  'speed.base_mph': isFiniteNumber,
  'speed.base_kmh': isFiniteNumber,
  'speed.walking_mph': isFiniteNumber,
  'wind.tailwind_coefficient_per_mph': isFiniteNumber,
  'wind.tailwind_min_mult': isFiniteNumber,
  'wind.headwind_coefficient_per_mph': isFiniteNumber,
  'wind.headwind_max_mult': isFiniteNumber,
  'wind.gale_threshold_mph': isFiniteNumber,
  'transmission.seconds_per_puff': isFiniteNumber,
  'transmission.chars_per_puff': isFiniteNumber,
  'message.char_cap': isFiniteNumber,
  'routing.unknown_cost_mult': isFiniteNumber,
  'preview.resolve_budget_seconds': isFiniteNumber,
  // --- MECHANICS-V2 §2, §3 · the sun (REDTEAM F32–F36) --------------------
  'night.enabled': isBoolean,
  'night.visuals_enabled': isBoolean,
  'night.time_mult': isFiniteNumber,
  'night.twilight_elevation_deg': isFiniteNumber,
  'night.blinding_conditions': isConditionList,
  'garble.daylight_only': isBoolean,

  'proximity.walk_suggest_max_minutes': isFiniteNumber,
  'proximity.walk_suggest_min_delivery_minutes': isFiniteNumber,

  // --- MECHANICS-V2 §5 · counsel (REDTEAM F37, F38, F42) ------------------
  'counsel.enabled': isBoolean,
  'counsel.candidate_offsets_hours': isNumberList,
  'counsel.include_dusk_dawn': isBoolean,
  'counsel.min_forecast_coverage': isFiniteNumber,
  'counsel.min_abs_minutes': isFiniteNumber,
  'counsel.min_fraction': isFiniteNumber,
  'forecast.cache_ttl_minutes': isFiniteNumber,
  'forecast.horizon_hours': isFiniteNumber,

  'preview.band_base_spread': isFiniteNumber,
  'preview.band_unknown_spread': isFiniteNumber,
  'preview.band_length_spread': isFiniteNumber,
  'preview.band_length_half_life_hours': isFiniteNumber,
  'warming.interval_minutes': isFiniteNumber,
  'warming.cells_per_pass': isFiniteNumber,
  'warming.active_user_days': isFiniteNumber,
  'routing.diagonal_distance_multiplier': isFiniteNumber,
  'routing.heuristic_max_speed_factor': isFiniteNumber,
  'routing.replan_interval_minutes': isFiniteNumber,
  'routing.delivery_check_interval_minutes': isFiniteNumber,
  'routing.dissipation_check_interval_hours': isFiniteNumber,
  'delivery.min_floor_minutes': isFiniteNumber,
  'preview.token_ttl_minutes': isFiniteNumber,
  'preview.eta_shift_warn_fraction': isFiniteNumber,
  'stranded.grace_hours': isFiniteNumber,
  'stranded.dissipation_chance_per_day': isFiniteNumber,
  'garble.gale_chance': isFiniteNumber,
  'garble.min_fraction': isFiniteNumber,
  'garble.max_fraction': isFiniteNumber,
  'garble.legibility_cap_fraction': isFiniteNumber,
  'relay.active_window_hours': isFiniteNumber,
  'relay.mult': isFiniteNumber,
  'relay.tend_window_minutes': isFiniteNumber,
  'relay.tend_mult': isFiniteNumber,
  'keeper.offset_cells': isFiniteNumber,
  'keeper.reply_delay_minutes': isFiniteNumber,
  'keeper.expected_delivery_minutes_min': isFiniteNumber,
  'keeper.expected_delivery_minutes_max': isFiniteNumber,
  'limits.sends_per_user_per_day': isFiniteNumber,
  'limits.pending_flock_requests_outbound': isFiniteNumber,
  'proximity.come_to_fire_waives_floor': isBoolean,
};

/** Immutable, fully validated view of `mechanics_config`. */
export class MechanicsConfig {
  private constructor(private readonly values: MechanicsValues) {}

  get<K extends MechanicsKey>(key: K): MechanicsValues[K] {
    return this.values[key];
  }

  /** Convenience for the one table-valued key. */
  timeMultFor(condition: WeatherCondition): number {
    const table: WeatherTimeMultTable = this.values['weather.time_mult'];
    return table[condition] ?? this.values['weather.unknown_time_mult'];
  }

  toJSON(): MechanicsValues {
    return { ...this.values };
  }

  /**
   * Build from `mechanics_config` rows. Throws unless every key is present and
   * type-correct. Unknown extra rows are ignored (forward compatibility with a
   * newer seed than this build).
   */
  static fromRows(rows: readonly MechanicsConfigRow[]): MechanicsConfig {
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const problems: string[] = [];
    const values: Record<string, unknown> = {};

    for (const key of MECHANICS_KEYS) {
      if (!byKey.has(key)) {
        problems.push(`${key}: missing from mechanics_config`);
        continue;
      }
      const value = byKey.get(key);
      const problem = VALIDATORS[key](value);
      if (problem) problems.push(`${key}: ${problem}`);
      else values[key] = value;
    }

    if (problems.length) {
      throw new MechanicsConfigError(
        'mechanics_config is incomplete or invalid — run `npm run db:seed`',
        problems,
      );
    }
    return new MechanicsConfig(values as unknown as MechanicsValues);
  }
}
