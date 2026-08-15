/**
 * How long, roughly (REDTEAM F30).
 *
 * The preview used to promise a timestamp — "arrives 1:53 AM" — and that promise
 * is what forced it to buy the whole corridor's weather before it dared speak.
 * It was also a fiction twice over: no forecast supports minute precision two
 * days out, and a signal fire does not make appointments.
 *
 * So a preview quotes a **band**, and the band widens for the two reasons an
 * estimate honestly gets worse: the journey is long, and we have not looked at
 * all of it. The precise arrival time still exists — it lives in the flight view
 * once the corridor resolves, and the server always knows the exact moment for
 * push.
 *
 * This is display arithmetic, not gameplay: it changes no route and no ETA. It
 * only decides how much certainty to claim.
 */

/**
 * How wide to draw the band. Every value comes from `mechanics_config`
 * (ARCHITECTURE §10) — these decide what the app promises a person, which is
 * exactly the kind of number that should not be buried in a source file.
 */
export interface BandSpread {
  base: number;
  unknown: number;
  length: number;
  lengthHalfLifeHours: number;
}

export function bandSpreadFrom(config: {
  get: (key: 'preview.band_base_spread' | 'preview.band_unknown_spread'
    | 'preview.band_length_spread' | 'preview.band_length_half_life_hours') => number;
}): BandSpread {
  return {
    base: config.get('preview.band_base_spread'),
    unknown: config.get('preview.band_unknown_spread'),
    length: config.get('preview.band_length_spread'),
    lengthHalfLifeHours: config.get('preview.band_length_half_life_hours'),
  };
}

export interface EtaBand {
  /** Optimistic end, in hours from departure. */
  lowHours: number;
  /** Pessimistic end, in hours from departure. */
  highHours: number;
  /** How wide the band is as a fraction of the estimate, for callers that care. */
  spread: number;
}

/**
 * The band around a quoted duration.
 *
 * `unknownFraction` is the share of the route whose weather we never saw — the
 * cells F28's budget did not buy. At 0 the band is narrow; at 1 it is wide, and
 * says so rather than quietly guessing.
 */
export function etaBand(
  totalHours: number,
  unknownFraction: number,
  widths: BandSpread,
): EtaBand {
  const ignorance = Math.min(1, Math.max(0, unknownFraction));
  const length = totalHours / (totalHours + widths.lengthHalfLifeHours);
  const spread = widths.base + widths.unknown * ignorance + widths.length * length;

  return {
    lowHours: Math.max(0, totalHours * (1 - spread)),
    highHours: totalHours * (1 + spread),
    spread,
  };
}

/**
 * The band as the Ledger would say it.
 *
 * Rounds to units a person would use out loud — a quarter hour near, a day out —
 * because a band reported as "between 41.6 and 58.2 hours" has swapped one false
 * precision for another.
 */
export function etaBandPhrase(band: EtaBand): string {
  const mid = (band.lowHours + band.highHours) / 2;

  if (mid < 1) {
    const minutes = Math.max(5, Math.round((mid * 60) / 5) * 5);
    return `about ${minutes} minutes`;
  }
  if (mid < 6) {
    const halves = Math.round(mid * 2) / 2;
    const text = halves === 1 ? 'an hour' : `${formatHalf(halves)} hours`;
    return `about ${text}`;
  }
  if (mid < 20) {
    return `roughly ${Math.round(mid)} hours`;
  }
  if (mid < 36) {
    return 'about a day';
  }

  const days = mid / 24;
  // Past a day, "two days" and "two and a half days" are the only distinctions
  // anyone acts on.
  const halves = Math.round(days * 2) / 2;
  return `roughly ${formatHalf(halves)} days`;
}

function formatHalf(value: number): string {
  const whole = Math.floor(value);
  const half = value - whole >= 0.5;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const name = whole < words.length ? words[whole]! : String(whole);
  if (!half) return name;
  return whole === 0 ? 'half an' : `${name} and a half`;
}
