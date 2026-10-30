import { runDueScheduledPayments } from '../banking/payments';
import { startOfBankDay } from '../banking/common';
import type { Db } from '../db';
import { chargePremiums } from '../insurance/insurance';
import { closeStatements } from '../lending/creditCards';
import { billLoans } from '../lending/loans';
import { accrueInterest, matureCds, postMonthlyInterest } from './interest';

const DAY_MS = 86_400_000;
const LAST_DAY_KEY = 'lastBankDay';
/** Never catch up more than this many days in one go. */
const MAX_DAYS = 800;

/**
 * Everything that happens once per bank day, in order. Each step has its
 * own idempotency marker (accrual date, due dates, statement period), so
 * running a day twice changes nothing.
 */
export async function processBankDay(db: Db, day: Date) {
  const at = new Date(day.getTime() + 9 * 3_600_000); // opens at 9:00 UTC
  const dayEnd = new Date(day.getTime() + DAY_MS - 1);
  await accrueInterest(db, day); // interest for the days before `day`
  await postMonthlyInterest(db, day, at); // on the 1st, pay out last month
  await matureCds(db, dayEnd, at);
  await closeStatements(db, day, at);
  await billLoans(db, dayEnd, at);
  await chargePremiums(db, dayEnd, at);
  await runDueScheduledPayments(db, at);
}

/**
 * Catch up on every bank day since the last run, up to and including
 * today, then run anything scheduled for right now. Called every minute
 * by the server and right after the dev time machine moves the clock.
 */
export async function runBankDays(db: Db, now: Date) {
  const today = startOfBankDay(now);
  const row = await db.setting.findUnique({ where: { key: LAST_DAY_KEY } });
  let day = row ? new Date(Number(row.value) + DAY_MS) : today;
  for (let n = 0; day <= today && n < MAX_DAYS; n++, day = new Date(day.getTime() + DAY_MS)) {
    await processBankDay(db, day);
    await db.setting.upsert({
      where: { key: LAST_DAY_KEY },
      update: { value: String(day.getTime()) },
      create: { key: LAST_DAY_KEY, value: String(day.getTime()) },
    });
  }
  await runDueScheduledPayments(db, now);
}
