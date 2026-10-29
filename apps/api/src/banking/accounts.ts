import { CD_TERMS, type OpenAccountInput, type Statement } from '@dddbanker/shared';
import { getOwnedAccount, openAccount, toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import type { Db, Tx } from '../db';
import { AppError } from '../errors';
import { postTransaction } from '../ledger/ledger';
import { toCents } from '../money';
import { addMonths, requireDepositAccount } from './common';

const MAX_OPEN_ACCOUNTS = 12;

/** Open a savings account or CD, optionally funded from one of the customer's accounts. */
export async function openDepositAccount(
  tx: Tx,
  userId: string,
  input: OpenAccountInput,
  at: Date,
) {
  const openCount = await tx.account.count({ where: { userId, status: 'OPEN' } });
  if (openCount >= MAX_OPEN_ACCOUNTS) {
    throw new AppError(
      422,
      'LIMIT_EXCEEDED',
      `You can have up to ${MAX_OPEN_ACCOUNTS} open accounts.`,
    );
  }

  const term =
    input.type === 'CD' ? CD_TERMS.find((t) => t.months === input.termMonths) : undefined;
  const account = await openAccount(tx, {
    userId,
    type: input.type,
    at,
    ...(input.nickname
      ? { nickname: input.nickname }
      : term
        ? { nickname: `${term.months}-Month CD` }
        : {}),
  });
  if (term) {
    await tx.account.update({
      where: { id: account.id },
      data: {
        interestRateBps: term.rateBps,
        termMonths: term.months,
        maturesAt: addMonths(at, term.months),
      },
    });
  }

  const deposit = input.openingDepositCents ?? 0;
  if (deposit > 0 && input.fundingAccountId) {
    const from = await getOwnedAccount(tx, userId, input.fundingAccountId);
    requireDepositAccount(from, 'Funding a new account');
    const to = await tx.account.findUniqueOrThrow({ where: { id: account.id } });
    await postTransaction(tx, {
      type: 'TRANSFER',
      description: `Opening deposit to ${to.nickname}`,
      initiatedByUserId: userId,
      at,
      entries: [
        {
          accountId: from.id,
          amountCents: -BigInt(deposit),
          description: `Opening deposit to ${to.nickname}`,
        },
        {
          accountId: to.id,
          amountCents: BigInt(deposit),
          description: `Opening deposit from ${from.nickname}`,
        },
      ],
    });
  }

  await audit(tx, {
    userId,
    action: 'ACCOUNT_OPENED',
    metadata: { accountId: account.id, type: input.type, deposit },
    at,
  });
  return toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: account.id } }));
}

/** Month as [start, end) in UTC. */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** A monthly statement built straight from the ledger. */
export async function buildStatement(
  db: Db,
  userId: string,
  accountId: string,
  month: string,
): Promise<Statement> {
  const account = await getOwnedAccount(db, userId, accountId);
  const { start, end } = monthRange(month);

  const before = await db.ledgerEntry.findFirst({
    where: { accountId, createdAt: { lt: start } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfterCents: true },
  });
  const entries = await db.ledgerEntry.findMany({
    where: { accountId, createdAt: { gte: start, lt: end } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const opening = before?.balanceAfterCents ?? 0n;
  let credits = 0n;
  let debits = 0n;
  for (const e of entries) {
    if (e.amountCents > 0n) credits += e.amountCents;
    else debits += e.amountCents;
  }
  const closing = entries.at(-1)?.balanceAfterCents ?? opening;

  return {
    account: toAccountSummary(account),
    month,
    openingBalanceCents: toCents(opening),
    closingBalanceCents: toCents(closing),
    totalCreditsCents: toCents(credits),
    // Negative, like the debit lines themselves.
    totalDebitsCents: toCents(debits),
    lines: entries.map((e) => ({
      postedAt: e.createdAt.toISOString(),
      description: e.description,
      amountCents: toCents(e.amountCents),
      balanceAfterCents: toCents(e.balanceAfterCents),
    })),
  };
}
