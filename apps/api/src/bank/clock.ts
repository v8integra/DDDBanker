import type { Clock } from '../clock';
import type { Db } from '../db';

const OFFSET_KEY = 'bankClockOffsetMs';

/**
 * The bank's own "now": real time plus an offset that only the dev time
 * machine changes. Money (postings, interest, due dates, statements) uses
 * this; sessions, lockouts and rate limits stay on the real clock, so
 * jumping a month ahead doesn't sign everyone out.
 */
export class BankClock implements Clock {
  private offsetMs = 0;

  constructor(private readonly base: Clock) {}

  now() {
    return new Date(this.base.now().getTime() + this.offsetMs);
  }

  get offset() {
    return this.offsetMs;
  }

  async load(db: Db) {
    const row = await db.setting.findUnique({ where: { key: OFFSET_KEY } });
    this.offsetMs = row ? Number(row.value) : 0;
  }

  async advance(db: Db, ms: number) {
    this.offsetMs += ms;
    await db.setting.upsert({
      where: { key: OFFSET_KEY },
      update: { value: String(this.offsetMs) },
      create: { key: OFFSET_KEY, value: String(this.offsetMs) },
    });
  }
}
