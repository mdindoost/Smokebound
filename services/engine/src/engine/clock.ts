/**
 * Time, injected.
 *
 * Every cron and handler reads the clock from the context rather than calling
 * `new Date()`, so the whole state machine can be fast-forwarded in tests
 * (ARCHITECTURE §9: "time-travel tests with a mocked clock").
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_MINUTE = 60_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

export function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * MS_PER_HOUR);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MS_PER_MINUTE);
}
