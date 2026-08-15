import { describe, expect, it } from 'vitest';

import { GRID, assertGridMatchesConfig } from '../geo/grid.js';
import { MECHANICS_DEFAULTS, MECHANICS_KEYS, MECHANICS_SPEC, mechanicsSeedRows } from './defaults.js';
import { MechanicsConfig, MechanicsConfigError } from './config.js';

const rows = mechanicsSeedRows();
const config = MechanicsConfig.fromRows(rows);

describe('mechanics defaults mirror MECHANICS.md', () => {
  it('§1 grid', () => {
    expect(MECHANICS_DEFAULTS['grid.cell_km']).toBe(50);
    expect(MECHANICS_DEFAULTS['grid.bbox']).toEqual({
      min_lat: 24,
      max_lat: 49.5,
      min_lng: -125,
      max_lng: -66,
    });
    expect(MECHANICS_DEFAULTS['grid.prefetch_padding_cells']).toBe(1);
    expect(MECHANICS_DEFAULTS['weather.cache_ttl_minutes']).toBe(30);
    expect(MECHANICS_DEFAULTS['weather.degraded_cache_ttl_minutes']).toBe(60);
  });

  it('§2 speed — km/h is canonical, mph is deprecated flavor (REDTEAM F12)', () => {
    expect(MECHANICS_DEFAULTS['speed.base_kmh']).toBe(32);
    expect(MECHANICS_SPEC['speed.base_kmh'].deprecated).toBeUndefined();
    expect(MECHANICS_DEFAULTS['speed.base_mph']).toBe(20);
    expect(MECHANICS_SPEC['speed.base_mph'].deprecated).toBe(true);
    // The two are not the same speed, which is exactly why only one may be used.
    expect(MECHANICS_DEFAULTS['speed.base_mph'] * 1.609344).not.toBe(
      MECHANICS_DEFAULTS['speed.base_kmh'],
    );
  });

  it('§2.1 weather multipliers, with severe-only impassability (REDTEAM F2)', () => {
    expect(MECHANICS_DEFAULTS['weather.time_mult']).toEqual({
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
    });
    expect(MECHANICS_DEFAULTS['weather.severe_alert_impassable']).toBe(true);
    // Fail-open rule (REDTEAM F4): unknown weather is clear, never impassable.
    expect(MECHANICS_DEFAULTS['weather.unknown_time_mult']).toBe(1.0);
    expect(MECHANICS_DEFAULTS['weather.stale_ttl_multiplier_unknown']).toBe(2);
  });

  it('§2.2 wind', () => {
    expect(MECHANICS_DEFAULTS['wind.tailwind_coefficient_per_mph']).toBe(0.01);
    expect(MECHANICS_DEFAULTS['wind.tailwind_min_mult']).toBe(0.7);
    expect(MECHANICS_DEFAULTS['wind.headwind_coefficient_per_mph']).toBe(0.015);
    expect(MECHANICS_DEFAULTS['wind.headwind_max_mult']).toBe(1.6);
    expect(MECHANICS_DEFAULTS['wind.gale_threshold_mph']).toBe(40);
  });

  it('§3 transmission: 280 chars ≈ 3.5 minutes of puffing', () => {
    const secondsPerPuff = MECHANICS_DEFAULTS['transmission.seconds_per_puff'];
    const charsPerPuff = MECHANICS_DEFAULTS['transmission.chars_per_puff'];
    expect(secondsPerPuff).toBe(3);
    expect(charsPerPuff).toBe(4);
    const seconds = secondsPerPuff * Math.ceil(MECHANICS_DEFAULTS['message.char_cap'] / charsPerPuff);
    expect(seconds / 60).toBeCloseTo(3.5, 1);
  });

  it('§5 message cap', () => {
    expect(MECHANICS_DEFAULTS['message.char_cap']).toBe(280);
  });

  it('§4 routing cadence and A* constants (REDTEAM F3)', () => {
    expect(MECHANICS_DEFAULTS['routing.replan_interval_minutes']).toBe(15);
    expect(MECHANICS_DEFAULTS['routing.delivery_check_interval_minutes']).toBe(1);
    expect(MECHANICS_DEFAULTS['routing.dissipation_check_interval_hours']).toBe(1);
    expect(MECHANICS_DEFAULTS['routing.diagonal_distance_multiplier']).toBe(1.414);
    // Heuristic speed must equal the maximum achievable speed, i.e. full tailwind.
    expect(MECHANICS_DEFAULTS['routing.heuristic_max_speed_factor']).toBe(
      MECHANICS_DEFAULTS['wind.tailwind_min_mult'],
    );
  });

  it('§6 failure states', () => {
    expect(MECHANICS_DEFAULTS['stranded.grace_hours']).toBe(24);
    expect(MECHANICS_DEFAULTS['stranded.dissipation_chance_per_day']).toBe(0.05);
    expect(MECHANICS_DEFAULTS['garble.gale_chance']).toBe(0.35);
    expect(MECHANICS_DEFAULTS['garble.min_fraction']).toBe(0.03);
    expect(MECHANICS_DEFAULTS['garble.max_fraction']).toBe(0.1);
    expect(MECHANICS_DEFAULTS['garble.legibility_cap_fraction']).toBe(0.1);
    expect(MECHANICS_DEFAULTS['garble.max_fraction']).toBeLessThanOrEqual(
      MECHANICS_DEFAULTS['garble.legibility_cap_fraction'],
    );
  });

  it('§7 delivery floor, walking estimate and relays', () => {
    expect(MECHANICS_DEFAULTS['delivery.min_floor_minutes']).toBe(10);
    expect(MECHANICS_DEFAULTS['speed.walking_mph']).toBe(3);
    expect(MECHANICS_DEFAULTS['relay.active_window_hours']).toBe(24);
    expect(MECHANICS_DEFAULTS['relay.mult']).toBe(0.5);
    expect(MECHANICS_DEFAULTS['relay.tend_window_minutes']).toBe(30);
    expect(MECHANICS_DEFAULTS['relay.tend_mult']).toBe(0.1);
  });

  it('carries the Keeper and abuse limits (REDTEAM F5, ARCHITECTURE §8)', () => {
    expect(MECHANICS_DEFAULTS['keeper.offset_cells']).toBe(1);
    expect(MECHANICS_DEFAULTS['keeper.reply_delay_minutes']).toBe(30);
    expect(MECHANICS_DEFAULTS['keeper.expected_delivery_minutes_min']).toBe(10);
    expect(MECHANICS_DEFAULTS['keeper.expected_delivery_minutes_max']).toBe(60);
    expect(MECHANICS_DEFAULTS['limits.sends_per_user_per_day']).toBe(30);
    expect(MECHANICS_DEFAULTS['limits.pending_flock_requests_outbound']).toBe(5);
  });

  it('reproduces the §7A worked example: Newark → Chicago ≈ 36 h in clear skies', () => {
    const km = 1150;
    const hours = km / MECHANICS_DEFAULTS['speed.base_kmh'];
    expect(hours).toBeGreaterThan(34);
    expect(hours).toBeLessThan(38);
  });

  it('reproduces the §7C worked example: Newark → Miami in half light rain ≈ 82 h', () => {
    const base = MECHANICS_DEFAULTS['speed.base_kmh'];
    const rainMult = MECHANICS_DEFAULTS['weather.time_mult'].light_rain;
    const hours = 875 / base + (875 / base) * rainMult;
    expect(hours).toBeGreaterThan(78);
    expect(hours).toBeLessThan(86);
  });

  it('documents provenance and TUNE status for every key', () => {
    for (const key of MECHANICS_KEYS) {
      const entry = MECHANICS_SPEC[key];
      // MECHANICS-V2 is a document in its own right, not a variant spelling.
      // Milestone work orders (M5.7 §2) are a legitimate provenance alongside the
      // standing documents: they are where a ruling was actually made.
      expect(entry.source).toMatch(/^(MECHANICS(-V2)?|ARCHITECTURE|SPEC|REDTEAM|DESIGN|M\d(\.\d)?) §?/);
      expect(typeof entry.tune).toBe('boolean');
    }
    // The five numbers MECHANICS §8 flags as most likely to move must be tunable.
    for (const key of [
      'speed.base_kmh', // canonical; speed.base_mph is deprecated display copy (REDTEAM F12)
      'delivery.min_floor_minutes',
      'garble.gale_chance',
      'routing.replan_interval_minutes',
      'stranded.dissipation_chance_per_day',
    ] as const) {
      expect(MECHANICS_SPEC[key].tune).toBe(true);
    }
  });

  it('has no duplicate keys and produces one seed row per key', () => {
    expect(new Set(MECHANICS_KEYS).size).toBe(MECHANICS_KEYS.length);
    expect(rows).toHaveLength(MECHANICS_KEYS.length);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('is JSON-serialisable, as jsonb requires', () => {
    for (const row of rows) {
      expect(JSON.parse(JSON.stringify(row.value))).toEqual(row.value);
    }
  });
});

describe('MechanicsConfig loader', () => {
  it('loads a complete seed', () => {
    expect(config.get('speed.base_kmh')).toBe(MECHANICS_DEFAULTS['speed.base_kmh']);
    expect(config.get('weather.severe_alert_impassable')).toBe(true);
    expect(config.toJSON()).toEqual(MECHANICS_DEFAULTS);
  });

  it('refuses to fall back when a key is missing', () => {
    const partial = rows.filter((r) => r.key !== 'speed.base_kmh');
    expect(() => MechanicsConfig.fromRows(partial)).toThrow(MechanicsConfigError);
    try {
      MechanicsConfig.fromRows(partial);
    } catch (err) {
      expect((err as MechanicsConfigError).problems).toEqual([
        'speed.base_kmh: missing from mechanics_config',
      ]);
    }
  });

  it('rejects type-incorrect rows', () => {
    const broken = rows.map((r) =>
      r.key === 'speed.base_kmh' ? { key: r.key, value: 'fast' } : r,
    );
    expect(() => MechanicsConfig.fromRows(broken)).toThrow(/speed\.base_kmh/);

    const badTable = rows.map((r) =>
      r.key === 'weather.time_mult' ? { key: r.key, value: { clear: 1 } } : r,
    );
    expect(() => MechanicsConfig.fromRows(badTable)).toThrow(/weather\.time_mult/);

    const badBBox = rows.map((r) =>
      r.key === 'grid.bbox' ? { key: r.key, value: { min_lat: 50, max_lat: 24 } } : r,
    );
    expect(() => MechanicsConfig.fromRows(badBBox)).toThrow(/grid\.bbox/);
  });

  it('ignores unknown rows so a newer seed does not break an older build', () => {
    const extra = [...rows, { key: 'future.thing', value: 1 }];
    expect(() => MechanicsConfig.fromRows(extra)).not.toThrow();
  });

  it('falls back to the unknown multiplier for unmapped conditions', () => {
    expect(config.timeMultFor('thunderstorm')).toBe(
      MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm,
    );
    expect(config.timeMultFor('sharknado' as never)).toBe(
      MECHANICS_DEFAULTS['weather.unknown_time_mult'],
    );
  });
});

describe('grid/config agreement', () => {
  it('accepts a config that matches the compiled grid', () => {
    expect(() => assertGridMatchesConfig(config)).not.toThrow();
    expect(GRID.cellKm).toBe(config.get('grid.cell_km'));
  });

  it('refuses a config that silently re-grids the world', () => {
    const regridded = MechanicsConfig.fromRows(
      rows.map((r) => (r.key === 'grid.cell_km' ? { key: r.key, value: 25 } : r)),
    );
    expect(() => assertGridMatchesConfig(regridded)).toThrow(/persisted identifiers/);

    const moved = MechanicsConfig.fromRows(
      rows.map((r) =>
        r.key === 'grid.bbox'
          ? { key: r.key, value: { min_lat: 25, max_lat: 49.5, min_lng: -125, max_lng: -66 } }
          : r,
      ),
    );
    expect(() => assertGridMatchesConfig(moved)).toThrow(/grid\.bbox\.min_lat/);
  });
});
