import { formatCents } from '@dddbanker/shared';
import type { Tx } from '../db';
import { AppError } from '../errors';
import type { Account, TransactionType } from '../generated/prisma/client';

export interface EntryInput {
  accountId: string;
  /** Signed cents: positive credits the account's balance, negative debits it. */
  amountCents: bigint;
  description: string;
}

export interface PostInput {
  type: TransactionType;
  description: string;
  memo?: string | undefined;
  initiatedByUserId?: string | null;
  at: Date;
  entries: EntryInput[];
}

export class LedgerError extends Error {
  override name = 'LedgerError';
}

/** Customer deposit accounts can't go below zero. System, card and loan accounts can. */
function mayGoNegative(account: Pick<Account, 'userId' | 'type'>): boolean {
  return account.userId === null || !['CHECKING', 'SAVINGS', 'CD'].includes(account.type);
}

/**
 * Post one balanced, double-entry transaction. Must run inside a DB
 * transaction: if any leg fails (e.g. insufficient funds) the whole thing
 * rolls back.
 */
export async function postTransaction(tx: Tx, input: PostInput): Promise<string> {
  const { entries } = input;
  if (entries.length < 2) throw new LedgerError('A transaction needs at least two entries');
  if (entries.some((e) => e.amountCents === 0n)) throw new LedgerError('Entries cannot be zero');
  const total = entries.reduce((sum, e) => sum + e.amountCents, 0n);
  if (total !== 0n) throw new LedgerError(`Transaction is unbalanced by ${total} cents`);

  const transaction = await tx.transaction.create({
    data: {
      type: input.type,
      description: input.description,
      memo: input.memo ?? null,
      initiatedByUserId: input.initiatedByUserId ?? null,
      status: 'POSTED',
      createdAt: input.at,
    },
  });

  // Fixed order keeps row locks consistent on Postgres and avoids deadlocks.
  const ordered = [...entries].sort((a, b) => a.accountId.localeCompare(b.accountId));
  for (const entry of ordered) {
    const account = await tx.account.findUnique({ where: { id: entry.accountId } });
    if (!account) throw new LedgerError(`Unknown account ${entry.accountId}`);
    if (account.status !== 'OPEN') {
      throw new AppError(
        422,
        'ACCOUNT_NOT_OPEN',
        `${account.nickname} is not open for transactions.`,
      );
    }

    if (entry.amountCents < 0n && !mayGoNegative(account)) {
      // Conditional update: the balance check and the debit are one statement,
      // so two concurrent withdrawals can't both pass the check.
      const { count } = await tx.account.updateMany({
        where: { id: account.id, balanceCents: { gte: -entry.amountCents } },
        data: { balanceCents: { increment: entry.amountCents } },
      });
      if (count === 0) {
        throw new AppError(
          422,
          'INSUFFICIENT_FUNDS',
          `${account.nickname} doesn't have enough available. Balance: ${formatCents(Number(account.balanceCents))}.`,
        );
      }
    } else {
      await tx.account.update({
        where: { id: account.id },
        data: { balanceCents: { increment: entry.amountCents } },
      });
    }

    const { balanceCents } = await tx.account.findUniqueOrThrow({
      where: { id: account.id },
      select: { balanceCents: true },
    });
    await tx.ledgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: account.id,
        description: entry.description,
        amountCents: entry.amountCents,
        balanceAfterCents: balanceCents,
        createdAt: input.at,
      },
    });
  }

  return transaction.id;
}
