/**
 * Formatting for flight data.
 *
 * Distances are shown in miles because the copy is American and the fiction is
 * folksy ("412 miles from home", SPEC §6.4) — the *engine* is metric and stays
 * that way (REDTEAM F12). This module is the only place the two meet.
 */

const KM_PER_MILE = 1.609344;

export function milesFromKm(km: number): number {
  return km / KM_PER_MILE;
}

export function formatDistance(km: number): string {
  const miles = milesFromKm(km);
  if (miles < 1) return 'less than a mile';
  return `${Math.round(miles).toLocaleString()} mi`;
}

/** "3 h 20 min", "36 h", "4 days". */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) {
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    return minutes === 0 ? `${whole} h` : `${whole} h ${minutes} min`;
  }
  const days = hours / 24;
  if (days < 2) return `${Math.round(hours)} h`;
  return `${days.toFixed(1)} days`;
}

/** "today at 9:40 PM", "Sat at 6:12 AM", "Aug 18 at 3:00 PM". */
export function formatEta(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'unknown';
  const eta = new Date(iso);
  if (Number.isNaN(eta.getTime())) return 'unknown';

  const time = eta.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = daysApart(now, eta);

  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${eta.toLocaleDateString(undefined, { weekday: 'short' })} at ${time}`;
  return `${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

function daysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "just now", "12 min ago", "3 h ago", "Tue". */
export function formatSince(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return '';
  const then = new Date(iso);
  const minutes = (now.getTime() - then.getTime()) / 60_000;

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "3 min 30 s of puffing" — transmission time (MECHANICS §3). */
export function formatTransmission(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

export function formatWalk(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  return hours < 2 ? `${Math.round(minutes)} min` : `${hours.toFixed(1)} h`;
}
