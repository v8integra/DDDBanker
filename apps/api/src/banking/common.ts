import { formatCents } from '@dddbanker/shared';
import type { Db, Tx } from '../db';
import { AppError } from '../errors';
import type { Account, TransactionType } from '../generated/prisma/client';

/** Midnight UTC of the bank day containing `at`. */
export function startOfBankDay(at: Date) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Today's bank date as YYYY-MM-DD. */
export function bankDate(at: Date) {
  return startOfBankDay(at).toISOString().slice(0, 10);
}

export function addMonths(date: Date, months: number) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp: Jan 31 + 1 month = Feb 28/29, not Mar 3.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export const DEPOSIT_TYPES = new Set(['CHECKING', 'SAVINGS']);

/** Cash, checks, transfers and payments only move through checking and savings. */
export function requireDepositAccount(account: Account, action: string) {
  if (!DEPOSIT_TYPES.has(account.type)) {
    const reason =
      account.type === 'CD'
        ? "CDs can't be used until they mature."
        : 'Use a checking or savings account.';
    throw new AppError(
      422,
      'TRANSFER_NOT_ALLOWED',
      `${action} isn't available for ${account.nickname}. ${reason}`,
    );
  }
}

/**
 * Total (as a positive number of cents) that left these accounts today in
 * transactions of the given types, optionally through one channel. Used for
 * daily limits.
 */
export async function outgoingToday(
  tx: Tx,
  accountIds: string[],
  at: Date,
  { types, channel }: { types: TransactionType[]; channel?: string },
): Promise<bigint> {
  const { _sum } = await tx.ledgerEntry.aggregate({
    _sum: { amountCents: true },
    where: {
      accountId: { in: accountIds },
      amountCents: { lt: 0 },
      createdAt: { gte: startOfBankDay(at) },
      transaction: { type: { in: types }, ...(channel ? { channel } : {}) },
    },
  });
  return -(_sum.amountCents ?? 0n);
}

export function assertWithinLimit(spent: bigint, amount: number, limit: number, what: string) {
  if (spent + BigInt(amount) > BigInt(limit)) {
    const left = Math.max(0, limit - Number(spent));
    throw new AppError(
      422,
      'LIMIT_EXCEEDED',
      `That's over your daily ${what} limit of ${formatCents(limit)}. You can still use ${formatCents(left)} today.`,
    );
  }
}

/** A message for the customer's notification bell. */
export async function notify(db: Db | Tx, userId: string, type: string, message: string, at: Date) {
  await db.notification.create({ data: { userId, type, message, createdAt: at } });
}
