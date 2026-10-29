/**
 * Source of "now" for the whole API, injected so tests can move time.
 * Phase 6 adds a simulated bank clock (for interest and statements) on top of this.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function minutesFrom(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
