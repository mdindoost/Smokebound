/**
 * The visual rulings, as tests (DESIGN.md V1–V4).
 *
 * A palette is easy to erode one screen at a time. These are the few properties
 * worth pinning: the sky panel stays dark, weather stays under its ceiling,
 * ember stays the only loud colour, and the state semantics stay elegiac.
 */

import { describe, expect, it } from 'vitest';

import { RADAR_OPACITY, RADAR_WMS_URL, sky } from '../src/design/sky';
import { colors, palette, stateColor } from '../src/design/tokens';

/** Relative luminance, for "is this dark?" questions. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrast = (a: string, b: string): number => {
  const [light, dark] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
};

describe('V1: the sky panel is a dark inset, not a dark theme', () => {
  it('keeps the app chrome light', () => {
    expect(luminance(colors.background)).toBeGreaterThan(0.6);
    expect(luminance(colors.surface)).toBeGreaterThan(0.6);
  });

  it('keeps the panel dark', () => {
    for (const token of [sky.ground, sky.raised, sky.land, sky.water]) {
      expect(luminance(token)).toBeLessThan(0.06);
    }
  });

  it('gives panel text enough contrast to read at a glance', () => {
    expect(contrast(sky.text, sky.ground)).toBeGreaterThan(7);
    expect(contrast(sky.textFaint, sky.ground)).toBeGreaterThan(4.5);
  });

  it('has a counterpart for every parchment role, ready for a full dark mode', () => {
    for (const role of ['ground', 'raised', 'line', 'text', 'textFaint'] as const) {
      expect(sky[role]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('V2: weather is contained', () => {
  it('keeps radar under its opacity ceiling', () => {
    expect(RADAR_OPACITY).toBeLessThanOrEqual(0.6);
    expect(RADAR_OPACITY).toBeGreaterThan(0.3); // still legible weather
  });

  it('takes radar from NOAA, keylessly', () => {
    expect(RADAR_WMS_URL).toContain('noaa.gov');
    expect(RADAR_WMS_URL).not.toMatch(/key=|token=/); // keyless, or it stops working silently
    // The bbox placeholders <WMSTile> substitutes. A tile-indexed `{z}/{y}/{x}`
    // URL here would be the bug that shipped a radar layer over a dead service.
    for (const token of ['{minX}', '{minY}', '{maxX}', '{maxY}', '{width}', '{height}']) {
      expect(RADAR_WMS_URL).toContain(token);
    }
    expect(RADAR_WMS_URL).not.toContain('{z}');
    expect(RADAR_WMS_URL).toContain('srs=EPSG:3857'); // matches the map projection
  });

  it('leaves the smoke as the brightest thing on the panel', () => {
    const others = [sky.ahead, sky.sheltering, sky.lost, sky.tower, sky.unknown, sky.storm];
    for (const colour of others) {
      expect(luminance(sky.trailGlow)).toBeGreaterThan(luminance(colour));
    }
  });
});

describe('V4: state semantics stay elegiac', () => {
  it('never uses an alarm colour for sheltering or loss', () => {
    expect(stateColor('STRANDED')).toBe(palette.storm);
    expect(stateColor('LOST')).toBe(palette.ash);
    // Neither is the ember: nothing shouts about waiting or grief.
    expect(stateColor('STRANDED')).not.toBe(colors.accent);
    expect(stateColor('LOST')).not.toBe(colors.accent);
  });

  it('gives every state a distinct colour', () => {
    const states = ['TRANSMITTING', 'IN_FLIGHT', 'STRANDED', 'DELIVERED', 'LOST'];
    expect(new Set(states.map(stateColor)).size).toBe(states.length);
  });

  it('keeps every state readable on parchment', () => {
    // Chips are 12px uppercase text: WCAG's 3:1 floor for UI components is the
    // bar, and the ember used on the dark panel is too light to clear it here.
    for (const state of ['TRANSMITTING', 'IN_FLIGHT', 'STRANDED', 'DELIVERED', 'LOST']) {
      expect(contrast(stateColor(state), colors.background), state).toBeGreaterThan(3);
    }
  });
});
