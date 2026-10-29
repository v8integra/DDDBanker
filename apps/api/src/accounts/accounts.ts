import { randomInt } from 'node:crypto';
import type { AccountDetail, AccountSummary, AccountType } from '@dddbanker/shared';
import type { Tx } from '../db';
import { notFound } from '../errors';
import type { Account } from '../generated/prisma/client';
import { toCents } from '../money';

const DEFAULT_NICKNAMES: Record<AccountType, string> = {
  CHECKING: 'Everyday Checking',
  SAVINGS: 'Bramble Savings',
  CD: 'Certificate of Deposit',
  CREDIT_CARD: 'Bramble Card',
  AUTO_LOAN: 'Auto Loan',
  MORTGAGE: 'Home Loan',
  PERSONAL_LOAN: 'Personal Loan',
};

const DEFAULT_RATES_BPS: Partial<Record<AccountType, number>> = {
  SAVINGS: 350,
};

async function generateAccountNumber(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    // Fictional range: always starts with 77 so it can't collide with real formats we display.
    const number = `77${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    if (!(await tx.account.findUnique({ where: { number }, select: { id: true } }))) return number;
  }
  throw new Error('Could not generate a unique account number');
}

export async function openAccount(
  tx: Tx,
  {
    userId,
    type,
    at,
    nickname,
  }: { userId: string; type: AccountType; at: Date; nickname?: string },
) {
  return tx.account.create({
    data: {
      userId,
      type,
      nickname: nickname ?? DEFAULT_NICKNAMES[type],
      number: await generateAccountNumber(tx),
      interestRateBps: DEFAULT_RATES_BPS[type] ?? 0,
      createdAt: at,
    },
  });
}

/**
 * Fetch an account only if it belongs to this user. Anything else is a 404,
 * so other customers' account ids can't be probed.
 */
export async function getOwnedAccount(tx: Tx, userId: string, accountId: string): Promise<Account> {
  const account = await tx.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound('That account');
  return account;
}

export function toAccountSummary(account: Account): AccountSummary {
  return {
    id: account.id,
    type: account.type as AccountType,
    nickname: account.nickname,
    maskedNumber: `••••${account.number.slice(-4)}`,
    status: account.status,
    balanceCents: toCents(account.balanceCents),
    interestRateBps: account.interestRateBps,
  };
}

export function toAccountDetail(account: Account): AccountDetail {
  return {
    ...toAccountSummary(account),
    number: account.number,
    createdAt: account.createdAt.toISOString(),
  };
}
