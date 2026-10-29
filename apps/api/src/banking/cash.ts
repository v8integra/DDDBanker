import type { z } from 'zod';
import {
  LIMITS,
  formatCents,
  type MoneyMoveResult,
  type depositSchema,
  type withdrawalSchema,
} from '@dddbanker/shared';
import { getOwnedAccount, toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { assertWithinLimit, notify, outgoingToday, requireDepositAccount } from './common';

type Deposit = z.output<typeof depositSchema>;
type Withdrawal = z.output<typeof withdrawalSchema>;

/** Simulated check or cash deposit at the teller or ATM. */
export async function deposit(
  tx: Tx,
  userId: string,
  input: Deposit,
  at: Date,
): Promise<MoneyMoveResult> {
  const account = await getOwnedAccount(tx, userId, input.accountId);
  requireDepositAccount(account, 'Deposits');

  const isCheck = input.method === 'CHECK';
  const source = await getSystemAccountId(tx, isCheck ? 'EXTERNAL_CLEARING' : 'CASH_VAULT');
  const where = input.channel === 'ATM' ? 'ATM' : 'teller';
  const label = `${isCheck ? 'Check' : 'Cash'} deposit (${where})`;
  const transactionId = await postTransaction(tx, {
    type: 'DEPOSIT',
    description: label,
    channel: input.channel,
    initiatedByUserId: userId,
    at,
    entries: [
      {
        accountId: source,
        amountCents: -BigInt(input.amountCents),
        description: `${label} for ${account.number}`,
      },
      { accountId: account.id, amountCents: BigInt(input.amountCents), description: label },
    ],
  });

  await audit(tx, {
    userId,
    action: 'DEPOSIT',
    metadata: { transactionId, accountId: account.id, amountCents: input.amountCents },
    at,
  });
  await notify(
    tx,
    userId,
    'DEPOSIT',
    `${label} of ${formatCents(input.amountCents)} posted to ${account.nickname}.`,
    at,
  );
  return {
    transactionId,
    account: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: account.id } })),
  };
}

/** Cash withdrawal. The ATM pays out $20 notes and has a daily limit. */
export async function withdraw(
  tx: Tx,
  userId: string,
  input: Withdrawal,
  at: Date,
): Promise<MoneyMoveResult> {
  const account = await getOwnedAccount(tx, userId, input.accountId);
  requireDepositAccount(account, 'Withdrawals');

  if (input.channel === 'ATM') {
    if (input.amountCents % LIMITS.atmNoteCents !== 0) {
      throw new AppError(
        400,
        'VALIDATION',
        'This ATM pays out $20 notes. Choose an amount in $20s.',
        {
          amountCents: 'Choose an amount in $20s',
        },
      );
    }
    const accounts = await tx.account.findMany({ where: { userId }, select: { id: true } });
    const spent = await outgoingToday(
      tx,
      accounts.map((a) => a.id),
      at,
      { types: ['WITHDRAWAL'], channel: 'ATM' },
    );
    assertWithinLimit(spent, input.amountCents, LIMITS.atmDailyCents, 'ATM');
  }

  const vault = await getSystemAccountId(tx, 'CASH_VAULT');
  const label = input.channel === 'ATM' ? 'ATM withdrawal' : 'Teller withdrawal';
  const transactionId = await postTransaction(tx, {
    type: 'WITHDRAWAL',
    description: label,
    channel: input.channel,
    initiatedByUserId: userId,
    at,
    entries: [
      { accountId: account.id, amountCents: -BigInt(input.amountCents), description: label },
      {
        accountId: vault,
        amountCents: BigInt(input.amountCents),
        description: `${label} from ${account.number}`,
      },
    ],
  });

  await audit(tx, {
    userId,
    action: 'WITHDRAWAL',
    metadata: { transactionId, accountId: account.id, amountCents: input.amountCents },
    at,
  });
  return {
    transactionId,
    account: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: account.id } })),
  };
}
