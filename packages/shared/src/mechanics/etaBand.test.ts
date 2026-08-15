/**
 * REDTEAM F30 — a signal fire does not make appointments.
 */

import { describe, expect, it } from 'vitest';

import { MechanicsConfig } from './config.js';
import { bandSpreadFrom, etaBand as rawBand, etaBandPhrase } from './etaBand.js';
import { mechanicsSeedRows } from './defaults.js';

const WIDTHS = bandSpreadFrom(MechanicsConfig.fromRows(mechanicsSeedRows()));
const etaBand = (hours: number, unknown = 0) => rawBand(hours, unknown, WIDTHS);

describe('etaBand', () => {
  it('widens when we have not looked at the route', () => {
    const looked = etaBand(36, 0);
    const blind = etaBand(36, 1);
    expect(blind.spread).toBeGreaterThan(looked.spread);
    expect(blind.highHours).toBeGreaterThan(looked.highHours);
    expect(blind.lowHours).toBeLessThan(looked.lowHours);
  });

  it('widens for longer journeys even in full knowledge', () => {
    expect(etaBand(80, 0).spread).toBeGreaterThan(etaBand(2, 0).spread);
  });

  it('always contains the estimate it is built around', () => {
    for (const hours of [0.5, 4, 36, 81]) {
      for (const unknown of [0, 0.5, 1]) {
        const band = etaBand(hours, unknown);
        expect(band.lowHours).toBeLessThanOrEqual(hours);
        expect(band.highHours).toBeGreaterThanOrEqual(hours);
      }
    }
  });

  it('never promises arrival in the past', () => {
    expect(etaBand(0.2, 1).lowHours).toBeGreaterThanOrEqual(0);
  });
});

describe('etaBandPhrase', () => {
  it('speaks in units a person would use out loud', () => {
    expect(etaBandPhrase(etaBand(0.4, 0))).toMatch(/^about \d+ minutes$/);
    expect(etaBandPhrase(etaBand(1, 0))).toBe('about an hour');
    expect(etaBandPhrase(etaBand(4, 0))).toBe('about four hours');
    expect(etaBandPhrase(etaBand(12, 0))).toBe('roughly 12 hours');
    expect(etaBandPhrase(etaBand(26, 0))).toBe('about a day');
    expect(etaBandPhrase(etaBand(48, 0))).toBe('roughly two days');
    expect(etaBandPhrase(etaBand(81, 0))).toMatch(/^roughly (three and a half|four) days$/);
  });

  it('never quotes a minute or a timestamp', () => {
    // The whole point of F30: the preview stopped claiming precision it does not
    // have. If a colon ever appears here, someone has put the clock back.
    for (const hours of [0.3, 1.5, 9, 30, 81]) {
      const phrase = etaBandPhrase(etaBand(hours, 0.5));
      expect(phrase).not.toMatch(/:/);
      expect(phrase).toMatch(/^(about|roughly)\b/);
    }
  });
});
