/**
 * Mapping NWS forecast text onto the MECHANICS §2.1 condition buckets.
 *
 * NWS `shortForecast` is free-ish text ("Chance Showers And Thunderstorms",
 * "Patchy Fog", "Mostly Sunny"), so the mapping is an ordered rule list: the
 * first pattern that matches wins, worst weather first. Anything unrecognised
 * becomes `unknown`, which fails open to clear (MECHANICS §2.1) — a forecast we
 * cannot parse must never strand a message.
 */

import type { WeatherCondition } from '@smoke/shared';

interface ConditionRule {
  pattern: RegExp;
  condition: WeatherCondition;
}

/** Order matters: the first match wins. */
export const CONDITION_RULES: readonly ConditionRule[] = [
  { pattern: /thunder|t-?storm/i, condition: 'thunderstorm' },
  { pattern: /heavy rain|torrential|downpour/i, condition: 'heavy_rain' },
  { pattern: /blizzard|snow|sleet|freezing|wintry|ice storm|flurries/i, condition: 'snow' },
  { pattern: /drizzle/i, condition: 'drizzle' },
  { pattern: /rain|shower|precipitation/i, condition: 'light_rain' },
  { pattern: /fog/i, condition: 'fog' },
  { pattern: /mist|haze|smoke|dust/i, condition: 'mist' },
  // "Partly Cloudy" and "Mostly Sunny" are the same sky from two directions.
  { pattern: /partly (cloudy|sunny)|mostly sunny|few clouds|slight/i, condition: 'few_clouds' },
  { pattern: /overcast|cloudy|clouds/i, condition: 'overcast' },
  { pattern: /sunny|clear|fair/i, condition: 'clear' },
];

export function mapNwsCondition(shortForecast: string | null | undefined): WeatherCondition {
  if (!shortForecast) return 'unknown';
  for (const rule of CONDITION_RULES) {
    if (rule.pattern.test(shortForecast)) return rule.condition;
  }
  return 'unknown';
}

/** 16-point compass → degrees the wind blows *from* (meteorological). */
const COMPASS: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

export function parseWindDirection(direction: string | null | undefined): number {
  if (!direction) return 0;
  const key = direction.trim().toUpperCase();
  return COMPASS[key] ?? 0;
}

/**
 * "10 mph" → 10; "10 to 15 mph" → 15.
 *
 * The upper bound of a range is the sustained speed we plan against: the gale
 * rule (MECHANICS §2.2) is about whether the wind *reaches* 40 mph, and rounding
 * that down would silently drop garble rolls.
 */
export function parseWindSpeedMph(windSpeed: string | null | undefined): number {
  if (!windSpeed) return 0;
  const numbers = windSpeed.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return 0;
  return Math.max(...numbers.map(Number));
}
