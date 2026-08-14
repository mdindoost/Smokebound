/**
 * User-facing words, in one place.
 *
 * Tone (SPEC §2): parchment, ember and sky; self-aware pointlessness; never
 * cute about the heritage the app borrows from. The cultural design rule is
 * binding here as much as in the palette — the history we lean on is worldwide
 * (beacon towers, torch telegraphs, signal fires), and no copy anywhere plays a
 * character.
 *
 * Kept pure so it can be tested and, later, translated (SPEC §3 v2: UI stays
 * English until a market justifies otherwise).
 */

import { formatDistance, formatDuration, formatEta, formatWalk } from './format.js';

export const stateLabel = (state: string): string => {
  switch (state) {
    case 'TRANSMITTING':
      return 'Transmitting';
    case 'IN_FLIGHT':
      return 'In flight';
    case 'STRANDED':
      return 'Sheltering';
    case 'DELIVERED':
      return 'Arrived';
    case 'LOST':
      return 'Lost to the sky';
    default:
      return state;
  }
};

export const stateBlurb = (state: string): string => {
  switch (state) {
    case 'TRANSMITTING':
      return 'The fire is puffing your message out, one breath at a time.';
    case 'IN_FLIGHT':
      return 'Your smoke is on its way.';
    case 'STRANDED':
      return 'Sheltering at the edge of a storm. It will move when the sky does.';
    case 'DELIVERED':
      return 'It arrived.';
    case 'LOST':
      return 'The sky took this one.';
    default:
      return '';
  }
};

export interface ProximityCopy {
  headline: string | null;
  footnote: string | null;
}

/**
 * Proximity flavour (MECHANICS §7.1). Same cell and adjacent cell both get the
 * "you could just walk over" nudge — the joke only lands if we say it first.
 */
export function proximityCopy(proximity: {
  sameCell: boolean;
  adjacent: boolean;
  distanceKm: number;
  walkMinutes: number;
}): ProximityCopy {
  if (!proximity.sameCell && !proximity.adjacent) {
    return { headline: null, footnote: null };
  }
  return {
    headline: proximity.sameCell
      ? 'They are close enough to see your smoke directly. You could just walk over. Send anyway?'
      : 'They are one hill away. You could walk it. Send anyway?',
    footnote: `On foot: ${formatWalk(proximity.walkMinutes)}.`,
  };
}

/** The line under a delivered message (MECHANICS §7.1). */
export function deliveredFootnote(distanceKm: number, walkMinutes: number): string {
  return `This signal travelled ${formatDistance(distanceKm)}. On foot: ${formatWalk(walkMinutes)}.`;
}

export interface RouteSummaryInput {
  totalHours: number | null;
  eta: string | null;
  distanceKm: number;
  stormsAvoided: number;
  noRoute: boolean;
  transmissionSeconds: number;
}

/** The pre-send summary, as text. The map version of this is M5. */
export function routeSummary(input: RouteSummaryInput, now: Date = new Date()): string[] {
  if (input.noRoute) {
    return [
      'The sky is closed in every direction right now.',
      'Your signal will wait at your fire and set out as soon as a gap opens.',
    ];
  }

  const lines = [
    `${formatDistance(input.distanceKm)} · ${formatDuration(input.totalHours ?? 0)} in the air`,
    `Arrives ${formatEta(input.eta, now)}`,
  ];

  if (input.stormsAvoided > 0) {
    lines.push(
      input.stormsAvoided === 1
        ? 'Routed around one storm on the way.'
        : `Routed around ${input.stormsAvoided} storms on the way.`,
    );
  }
  return lines;
}

/** The >20% ETA-shift warning (ARCHITECTURE §6.4). */
export function etaWarningCopy(warning: {
  previewedHours: number;
  actualHours: number | null;
  reason: 'slower' | 'faster' | 'no_route';
}): string {
  if (warning.reason === 'no_route') {
    return 'The sky closed while you were writing. Your signal is lit, and waits at your fire.';
  }
  const was = formatDuration(warning.previewedHours);
  const now = formatDuration(warning.actualHours ?? 0);
  return warning.reason === 'slower'
    ? `The weather turned while you were writing: ${was} became ${now}.`
    : `The weather improved while you were writing: ${was} became ${now}.`;
}

export const LOCATION_EXPLANATION = [
  'SMOKE needs to know roughly where your fire is, so it can work out how far your',
  'smoke has to travel.',
  '',
  'We ask for your approximate location once, and store only the 50 km cell it falls',
  'in — city-scale, never your exact position, never in the background. Your flock can',
  'see that cell; that is how they see your smoke coming. Nobody else can.',
  '',
  'You can move your fire whenever you like from Settings.',
].join('\n');

export const KEEPER_INTRO = [
  'The Keeper tends a fire one hill from yours.',
  '',
  'Send it something and watch the whole thing happen — the puffing, the flight, the',
  'arrival — in the time it takes to make dinner. It always answers.',
].join('\n');

/** The history note the app owes the practice it borrows from (SPEC §2). */
export const HISTORY_NOTE = [
  'Signal fire is one of the oldest ideas people have had.',
  '',
  'Beacon towers ran the length of the Great Wall, passing word faster than any rider.',
  'Polybius described a torch telegraph that could spell out any message in Greek.',
  'Aboriginal Australian nations and Native American nations used smoke to carry',
  'meaning across distances that took days to walk — practices that are living',
  'heritage, not history, and that belong to the people who keep them.',
  '',
  'SMOKE is a toy built on the shared human habit of talking with fire and distance.',
  'It borrows the idea, not anyone’s iconography.',
].join('\n');
