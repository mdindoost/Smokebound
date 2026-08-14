import { MECHANICS_DEFAULTS } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import {
  mapNwsCondition,
  parseWindDirection,
  parseWindSpeedMph,
} from '../../src/weather/conditions.js';

describe('mapNwsCondition (MECHANICS §2.1)', () => {
  const cases: [string, string][] = [
    ['Sunny', 'clear'],
    ['Clear', 'clear'],
    ['Mostly Clear', 'clear'],
    ['Mostly Sunny', 'few_clouds'],
    ['Partly Cloudy', 'few_clouds'],
    ['Partly Sunny', 'few_clouds'],
    ['Mostly Cloudy', 'overcast'],
    ['Cloudy', 'overcast'],
    ['Patchy Fog', 'fog'],
    ['Areas of Dense Fog', 'fog'],
    ['Haze', 'mist'],
    ['Areas of Smoke', 'mist'],
    ['Light Drizzle', 'drizzle'],
    ['Light Rain', 'light_rain'],
    ['Rain Showers', 'light_rain'],
    ['Chance Rain Showers', 'light_rain'],
    ['Heavy Rain', 'heavy_rain'],
    ['Torrential Rainfall', 'heavy_rain'],
    ['Snow', 'snow'],
    ['Chance Snow Showers', 'snow'],
    ['Freezing Rain', 'snow'],
    ['Blizzard Conditions', 'snow'],
    ['Thunderstorms', 'thunderstorm'],
    ['Chance Showers And Thunderstorms', 'thunderstorm'],
    ['Severe T-Storms Likely', 'thunderstorm'],
  ];

  for (const [forecast, expected] of cases) {
    it(`maps "${forecast}" → ${expected}`, () => {
      expect(mapNwsCondition(forecast)).toBe(expected);
    });
  }

  it('puts the worst weather first when a forecast mentions several', () => {
    // "Rain Then Thunderstorms" must not be priced as light rain.
    expect(mapNwsCondition('Rain Then Thunderstorms')).toBe('thunderstorm');
    expect(mapNwsCondition('Cloudy With Heavy Rain')).toBe('heavy_rain');
  });

  it('falls back to unknown, which fails open to clear', () => {
    for (const input of ['', null, undefined, 'Frogs', 'Volcanic Ash']) {
      expect(mapNwsCondition(input)).toBe('unknown');
    }
    expect(MECHANICS_DEFAULTS['weather.time_mult'].unknown).toBe(
      MECHANICS_DEFAULTS['weather.unknown_time_mult'],
    );
  });

  it('has a multiplier for every condition it can produce', () => {
    const table = MECHANICS_DEFAULTS['weather.time_mult'];
    for (const [forecast] of cases) {
      expect(table[mapNwsCondition(forecast)]).toBeTypeOf('number');
    }
  });
});

describe('wind parsing', () => {
  it('reads the upper bound of a range, so gales are not rounded away', () => {
    expect(parseWindSpeedMph('10 mph')).toBe(10);
    expect(parseWindSpeedMph('10 to 15 mph')).toBe(15);
    expect(parseWindSpeedMph('35 to 45 mph')).toBe(45);
    expect(parseWindSpeedMph('')).toBe(0);
    expect(parseWindSpeedMph(null)).toBe(0);
    expect(parseWindSpeedMph('Calm')).toBe(0);
  });

  it('crosses the gale threshold only when the wind really does', () => {
    const gale = MECHANICS_DEFAULTS['wind.gale_threshold_mph'];
    expect(parseWindSpeedMph('30 to 45 mph')).toBeGreaterThan(gale);
    expect(parseWindSpeedMph('25 to 35 mph')).toBeLessThan(gale);
  });

  it('maps the 16-point compass to degrees the wind blows from', () => {
    expect(parseWindDirection('N')).toBe(0);
    expect(parseWindDirection('E')).toBe(90);
    expect(parseWindDirection('S')).toBe(180);
    expect(parseWindDirection('W')).toBe(270);
    expect(parseWindDirection('NW')).toBe(315);
    expect(parseWindDirection('wsw')).toBe(247.5);
    expect(parseWindDirection('')).toBe(0);
    expect(parseWindDirection('sideways')).toBe(0);
  });
});
