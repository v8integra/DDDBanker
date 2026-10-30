import { formatCents } from '@dddbanker/shared';
import type { Db } from '../db';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { notify, startOfBankDay } from '../banking/common';
import { toCents } from '../money';

const DAY_MS = 86_400_000;

/**
 * Daily interest on savings and CDs, kept in thousandths of a cent so small
 * balances still earn something over a month. Rounded half-even per day.
 */
export function dailyInterestMilli(balanceCents: bigint, rateBps: number, days = 1): bigint {
  if (balanceCents <= 0n || rateBps <= 0 || days <= 0) return 0n;
  const numerator = balanceCents * 1000n * BigInt(rateBps) * BigInt(days);
  const denominator = 10_000n * 365n;
  let q = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && q % 2n === 1n)) q += 1n;
  return q;
}

/** Accrue `day`'s interest on every open savings account and CD (once per day per account). */
export async function accrueInterest(db: Db, day: Date) {
  const accounts = await db.account.findMany({
    where: { type: { in: ['SAVINGS', 'CD'] }, status: 'OPEN', interestRateBps: { gt: 0 } },
  });
  for (const a of accounts) {
    // Accounts start earning the day after they open.
    const from = a.interestAccruedThrough ?? startOfBankDay(a.createdAt);
    const days = Math.round((day.getTime() - from.getTime()) / DAY_MS);
    if (days <= 0) continue;
    const earned = dailyInterestMilli(a.balanceCents, a.interestRateBps, days);
    // Conditional on the marker, so a re-run (or a second scheduler) can't accrue twice.
    await db.account.updateMany({
      where: { id: a.id, interestAccruedThrough: a.interestAccruedThrough },
      data: { accruedInterestMilli: { increment: earned }, interestAccruedThrough: day },
    });
  }
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Pay the whole cents of accrued interest into the account; the fraction carries over. */
async function payAccrued(db: Db, accountId: string, at: Date, label: string, postedFor?: string) {
  return db.$transaction(async (tx) => {
    const a = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const cents = a.accruedInterestMilli / 1000n;
    await tx.account.update({
      where: { id: a.id },
      data: {
        accruedInterestMilli: { decrement: cents * 1000n },
        ...(postedFor ? { interestPostedFor: postedFor } : {}),
      },
    });
    if (cents <= 0n) return 0n;
    await postTransaction(tx, {
      type: 'INTEREST',
      description: label,
      channel: 'SYSTEM',
      at,
      entries: [
        {
          accountId: await getSystemAccountId(tx, 'INTEREST_EXPENSE'),
          amountCents: -cents,
          description: `${label} for ${a.number}`,
        },
        { accountId: a.id, amountCents: cents, description: label },
      ],
    });
    return cents;
  });
}

/** On the 1st, pay last month's interest (once per account per month). */
export async function postMonthlyInterest(db: Db, day: Date, at: Date) {
  if (day.getUTCDate() !== 1) return;
  const previous = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1));
  const forMonth = monthKey(previous);
  const accounts = await db.account.findMany({
    where: {
      type: { in: ['SAVINGS', 'CD'] },
      status: 'OPEN',
      // Spelled out: in SQL, NOT (x = y) skips rows where x is NULL.
      OR: [{ interestPostedFor: null }, { interestPostedFor: { not: forMonth } }],
    },
  });
  for (const a of accounts) {
    const paid = await payAccrued(db, a.id, at, 'Interest earned', forMonth);
    if (paid > 0n && a.userId) {
      await notify(
        db,
        a.userId,
        'INTEREST',
        `${a.nickname} earned ${formatCents(toCents(paid))} in interest last month.`,
        at,
      );
    }
  }
}

/**
 * A matured CD pays its interest, then its whole balance moves to the
 * customer's savings (or checking), and the CD closes.
 */
export async function matureCds(db: Db, dayEnd: Date, at: Date) {
  const due = await db.account.findMany({
    where: { type: 'CD', status: 'OPEN', maturesAt: { lte: dayEnd } },
  });
  for (const cd of due) {
    if (!cd.userId) continue;
    await payAccrued(db, cd.id, at, 'Interest at maturity');
    await db.$transaction(async (tx) => {
      const fresh = await tx.account.findUniqueOrThrow({ where: { id: cd.id } });
      if (fresh.status !== 'OPEN') return;
      const target =
        (await tx.account.findFirst({
          where: { userId: cd.userId, type: 'SAVINGS', status: 'OPEN' },
          orderBy: { createdAt: 'asc' },
        })) ??
        (await tx.account.findFirst({
          where: { userId: cd.userId, type: 'CHECKING', status: 'OPEN' },
          orderBy: { createdAt: 'asc' },
        }));
      if (!target) return;
      if (fresh.balanceCents > 0n) {
        await postTransaction(tx, {
          type: 'TRANSFER',
          description: `${fresh.nickname} matured`,
          channel: 'SYSTEM',
          at,
          entries: [
            {
              accountId: fresh.id,
              amountCents: -fresh.balanceCents,
              description: `Matured: paid to ${target.nickname}`,
            },
            {
              accountId: target.id,
              amountCents: fresh.balanceCents,
              description: `${fresh.nickname} matured`,
            },
          ],
        });
      }
      await tx.account.update({
        where: { id: fresh.id },
        data: { status: 'CLOSED', closedAt: at },
      });
      await notify(
        tx,
        cd.userId!,
        'CD_MATURED',
        `Your ${fresh.nickname} matured. ${formatCents(toCents(fresh.balanceCents))} moved to ${target.nickname}.`,
        at,
      );
    });
  }
}
