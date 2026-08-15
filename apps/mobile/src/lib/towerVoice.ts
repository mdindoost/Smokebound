/**
 * What the stations say (M5.7 §2).
 *
 * The Ledger records what happened to a message. These are the lines that let it
 * record what the *towers* saw — first person, because a chain of signal
 * stations is a chain of people, and "wind speed increased at cell r038c073" is
 * not something a person says.
 *
 * **Sender-side only, structurally.** These render from `events`, and
 * `events_select_visible_message` lets a recipient read events only once the
 * message is DELIVERED. A tower's voice therefore reaches the sender's Ledger
 * and nowhere else — R21 is enforced by the policy, not by remembering.
 *
 * **Three variants minimum per kind, chosen deterministically.** A flight is
 * re-rendered constantly — every poll, every clock tick — and copy that reshuffled
 * on each render would be unreadable. The variant is a hash of the event's own
 * identity, so a line is the same line every time you look at it, and two
 * different towers on the same route rarely say it the same way.
 */

import { towerNameFor } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

/** Which way the signal went, as a station would report it. */
function compassWord(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return 'on';
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'on';
}

/**
 * A stable index into the variants for one event.
 *
 * Deliberately not random: the same event must read the same way on every
 * render. Deliberately not the event id either — ids are sequential, so
 * consecutive events would march through the variants in order and the
 * pattern would show.
 */
function variantFor(seed: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

const SIGHTED = [
  (tower: string, way: string) => `The ${tower} tower reports: signal sighted, passing ${way}.`,
  (tower: string, way: string) => `${tower} has it in view — running ${way}, steady.`,
  (tower: string, way: string) => `Watch at ${tower}: smoke read clear, bearing ${way}.`,
];

const WIND_ROSE = [
  (tower: string, mph: number) => `Wind getting up over ${tower} — ${mph} mph and rising. We are holding the column as best we can.`,
  (tower: string, mph: number) => `${tower} reports a hard blow, ${mph} mph. The signal is taking a beating.`,
  (tower: string, mph: number) => `It is blowing ${mph} at ${tower}. Reading this one is work.`,
];

const WIND_EASED = [
  (tower: string) => `The wind has dropped at ${tower}. The column stands straight again.`,
  (tower: string) => `${tower}: air gone quiet. Much easier to read.`,
  (tower: string) => `Calm returning over ${tower}.`,
];

const FOG_SET_IN = [
  (tower: string) => `Cloud between us and the ${tower} light.`,
  (tower: string) => `${tower} has gone out of sight — the air ahead has closed.`,
  (tower: string) => `We have lost the ${tower} light in the murk. Waiting on it.`,
];

const SKY_CLEARED = [
  (tower: string) => `The ${tower} light is back. The air ahead has opened.`,
  (tower: string) => `Sight restored to ${tower} — we can pass it on.`,
  (tower: string) => `${tower} showing clear again.`,
];

const REDIRECTED = [
  () => 'Redirecting the fire along the ridge.',
  () => 'Passing the signal the long way round — the direct line is closed.',
  () => 'New bearing agreed between stations. The signal goes around.',
];

export interface NarrationEvent {
  kind: string;
  at: string;
  payload: Record<string, unknown> | null;
}

/**
 * A station's line for this event, or null when the event is not a tower voice.
 *
 * Returning null rather than a fallback is deliberate: lifecycle events already
 * have their own copy, and a tower improvising over "It arrived." would be two
 * voices talking at once.
 */
export function towerVoice(event: NarrationEvent): string | null {
  const cell = typeof event.payload?.['cell'] === 'string' ? (event.payload['cell'] as CellId) : null;
  const tower = cell === null ? null : towerNameFor(cell);
  // A station with no name cannot speak in the first person about itself.
  if (tower === null) return null;

  const seed = `${event.kind}:${cell}:${event.at}`;
  const mph = typeof event.payload?.['wind_mph'] === 'number' ? (event.payload['wind_mph'] as number) : 0;
  const bearing =
    typeof event.payload?.['heading_deg'] === 'number' ? (event.payload['heading_deg'] as number) : null;

  switch (event.kind) {
    case 'SIGHTED':
      return SIGHTED[variantFor(seed, SIGHTED.length)]!(tower, compassWord(bearing));
    case 'WIND_ROSE':
      return WIND_ROSE[variantFor(seed, WIND_ROSE.length)]!(tower, mph);
    case 'WIND_EASED':
      return WIND_EASED[variantFor(seed, WIND_EASED.length)]!(tower);
    case 'FOG_SET_IN':
      return FOG_SET_IN[variantFor(seed, FOG_SET_IN.length)]!(tower);
    case 'SKY_CLEARED':
      return SKY_CLEARED[variantFor(seed, SKY_CLEARED.length)]!(tower);
    case 'RESUMED':
      // A replan told as a decision the stations made, not as a state change a
      // server performed.
      return REDIRECTED[variantFor(seed, REDIRECTED.length)]!();
    default:
      return null;
  }
}

/** Every narration kind, for tests and for the Ledger's filtering. */
export const TOWER_VOICE_KINDS = [
  'SIGHTED',
  'WIND_ROSE',
  'WIND_EASED',
  'FOG_SET_IN',
  'SKY_CLEARED',
] as const;
