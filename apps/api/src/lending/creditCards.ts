import {
  applyBps,
  formatCents,
  type CreditCardAccountView,
  type CreditStatementView,
} from '@dddbanker/shared';
import type { z } from 'zod';
import type { loanPaymentSchema } from '@dddbanker/shared';
import { getOwnedAccount, openAccount } from '../accounts/accounts';
import { audit } from '../audit';
import { issueCard } from '../banking/cards';
import { notify, requireDepositAccount, startOfBankDay } from '../banking/common';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../errors';
import type { Account, CreditCardStatement, LoanApplication } from '../generated/prisma/client';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { toCents } from '../money';

const DAY_MS = 86_400_000;
const GRACE_DAYS = 25;
const LATE_FEE = 2_500n;
const MINIMUM_FLOOR = 2_500n;

/** Open the card account and issue the plastic. Called from acceptOffer. */
export async function openCreditCard(tx: Tx, userId: string, app: LoanApplication, at: Date) {
  const account = await openAccount(tx, { userId, type: 'CREDIT_CARD', at });
  await tx.account.update({
    where: { id: account.id },
    data: {
      creditLimitCents: app.offeredAmountCents,
      interestRateBps: app.offeredRateBps ?? 0,
      statementDay: Math.min(28, at.getUTCDate()),
    },
  });
  const card = await issueCard(tx, account.id, 'CREDIT', at);
  await audit(tx, {
    userId,
    action: 'LOAN_ACCEPTED',
    metadata: { applicationId: app.id, accountId: account.id, product: 'CREDIT_CARD' },
    at,
  });
  await notify(
    tx,
    userId,
    'CARD',
    `Your Bramble credit card ending ${card.last4} is ready, with a ${formatCents(toCents(app.offeredAmountCents ?? 0n))} limit.`,
    at,
  );
  return account;
}

/** Card payments made after `since`. */
async function paymentsSince(tx: Db | Tx, accountId: string, since: Date) {
  const { _sum } = await tx.ledgerEntry.aggregate({
    _sum: { amountCents: true },
    where: {
      accountId,
      amountCents: { gt: 0 },
      createdAt: { gt: since },
      transaction: { type: 'LOAN_PAYMENT' },
    },
  });
  return _sum.amountCents ?? 0n;
}

function toStatementView(s: CreditCardStatement, paid: bigint): CreditStatementView {
  return {
    periodStart: s.periodStart.toISOString(),
    periodEnd: s.periodEnd.toISOString(),
    statementBalanceCents: toCents(s.statementBalanceCents),
    minimumDueCents: toCents(s.minimumDueCents),
    dueDate: s.dueDate.toISOString(),
    interestCents: toCents(s.interestCents),
    feeCents: toCents(s.feeCents),
    paidCents: toCents(paid),
  };
}

async function toCardAccountView(db: Db | Tx, account: Account): Promise<CreditCardAccountView> {
  const latest = await db.creditCardStatement.findFirst({
    where: { accountId: account.id },
    orderBy: { periodEnd: 'desc' },
  });
  const card = await db.card.findFirst({
    where: { accountId: account.id, status: { in: ['ACTIVE', 'LOCKED'] } },
  });
  const owed = account.balanceCents < 0n ? -account.balanceCents : 0n;
  const limit = account.creditLimitCents ?? 0n;
  return {
    accountId: account.id,
    nickname: account.nickname,
    maskedNumber: `••••${account.number.slice(-4)}`,
    cardLast4: card?.last4 ?? null,
    creditLimitCents: toCents(limit),
    balanceOwedCents: toCents(owed),
    availableCents: toCents(limit + account.balanceCents > 0n ? limit + account.balanceCents : 0n),
    aprBps: account.interestRateBps,
    statementDay: account.statementDay ?? 1,
    latestStatement: latest
      ? toStatementView(latest, await paymentsSince(db, account.id, latest.periodEnd))
      : null,
  };
}

async function getOwnedCardAccount(db: Db | Tx, userId: string, accountId: string) {
  const account = await db.account.findFirst({
    where: { id: accountId, userId, type: 'CREDIT_CARD' },
  });
  if (!account) throw notFound('That credit card');
  return account;
}

export async function listCreditCards(db: Db, userId: string) {
  const accounts = await db.account.findMany({
    where: { userId, type: 'CREDIT_CARD', status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(accounts.map((a) => toCardAccountView(db, a)));
}

export async function listStatements(db: Db, userId: string, accountId: string) {
  const account = await getOwnedCardAccount(db, userId, accountId);
  const statements = await db.creditCardStatement.findMany({
    where: { accountId: account.id },
    orderBy: { periodEnd: 'desc' },
    take: 12,
  });
  return Promise.all(
    statements.map(async (s) =>
      toStatementView(s, await paymentsSince(db, account.id, s.periodEnd)),
    ),
  );
}

type PaymentInput = z.output<typeof loanPaymentSchema>;

export async function payCreditCard(
  tx: Tx,
  userId: string,
  accountId: string,
  input: PaymentInput,
  at: Date,
) {
  const account = await getOwnedCardAccount(tx, userId, accountId);
  const owed = account.balanceCents < 0n ? -account.balanceCents : 0n;
  if (owed === 0n)
    throw new AppError(422, 'VALIDATION', "You don't owe anything on this card right now.");
  if (BigInt(input.amountCents) > owed) {
    throw new AppError(
      400,
      'VALIDATION',
      `That's more than the ${formatCents(toCents(owed))} you owe.`,
      {
        amountCents: `You owe ${formatCents(toCents(owed))}`,
      },
    );
  }
  const from = await getOwnedAccount(tx, userId, input.fromAccountId);
  requireDepositAccount(from, 'Card payments');
  await postTransaction(tx, {
    type: 'LOAN_PAYMENT',
    description: `Payment to ${account.nickname}`,
    channel: 'ONLINE',
    initiatedByUserId: userId,
    at,
    entries: [
      {
        accountId: from.id,
        amountCents: -BigInt(input.amountCents),
        description: `Payment: ${account.nickname}`,
      },
      {
        accountId: account.id,
        amountCents: BigInt(input.amountCents),
        description: `Payment from ${from.nickname} — thank you`,
      },
    ],
  });
  await audit(tx, {
    userId,
    action: 'LOAN_PAYMENT',
    metadata: { accountId, amountCents: input.amountCents },
    at,
  });
  return toCardAccountView(tx, await tx.account.findUniqueOrThrow({ where: { id: account.id } }));
}

/**
 * Close the month for every card whose statement day is `day`:
 * - interest at APR/12 on the balance if last statement wasn't paid in full by now;
 * - a late fee if not even the minimum was paid;
 * - a new statement: balance, minimum (2%, at least $25, plus interest and fees), due in 25 days.
 */
export async function closeStatements(db: Db, day: Date, at: Date) {
  const accounts = await db.account.findMany({
    // Only cards that were already open before this day (matters when replaying past days).
    where: {
      type: 'CREDIT_CARD',
      status: 'OPEN',
      statementDay: day.getUTCDate(),
      createdAt: { lt: day },
    },
  });
  for (const account of accounts) {
    await db.$transaction(async (tx) => {
      if (
        await tx.creditCardStatement.findUnique({
          where: { accountId_periodEnd: { accountId: account.id, periodEnd: day } },
        })
      )
        return;
      const prev = await tx.creditCardStatement.findFirst({
        where: { accountId: account.id },
        orderBy: { periodEnd: 'desc' },
      });
      const paid = prev ? await paymentsSince(tx, account.id, prev.periodEnd) : 0n;
      const current = await tx.account.findUniqueOrThrow({ where: { id: account.id } });
      const owed = current.balanceCents < 0n ? -current.balanceCents : 0n;

      let interest = 0n;
      if (
        prev &&
        prev.statementBalanceCents > 0n &&
        paid < prev.statementBalanceCents &&
        owed > 0n
      ) {
        interest = BigInt(applyBps(toCents(owed), current.interestRateBps, 12));
      }
      let fee = 0n;
      if (prev && prev.minimumDueCents > 0n && paid < prev.minimumDueCents && prev.dueDate <= day)
        fee = LATE_FEE;

      const charge = async (
        amount: bigint,
        type: 'INTEREST' | 'FEE',
        label: string,
        code: 'INTEREST_INCOME' | 'FEES_INCOME',
      ) => {
        if (amount <= 0n) return;
        await postTransaction(tx, {
          type,
          description: label,
          channel: 'SYSTEM',
          at,
          entries: [
            { accountId: account.id, amountCents: -amount, description: label },
            {
              accountId: await getSystemAccountId(tx, code),
              amountCents: amount,
              description: `${label} on ${account.number}`,
            },
          ],
        });
      };
      await charge(interest, 'INTEREST', 'Interest charge', 'INTEREST_INCOME');
      await charge(fee, 'FEE', 'Late payment fee', 'FEES_INCOME');

      const balance = owed + interest + fee;
      const twoPercent = BigInt(applyBps(toCents(balance), 200));
      const floor = twoPercent > MINIMUM_FLOOR ? twoPercent : MINIMUM_FLOOR;
      const wanted = floor + interest + fee;
      const minimum = balance === 0n ? 0n : wanted > balance ? balance : wanted;
      const dueDate = new Date(day.getTime() + GRACE_DAYS * DAY_MS);

      await tx.creditCardStatement.create({
        data: {
          accountId: account.id,
          periodStart: prev?.periodEnd ?? startOfBankDay(account.createdAt),
          periodEnd: day,
          statementBalanceCents: balance,
          minimumDueCents: minimum,
          dueDate,
          interestCents: interest,
          feeCents: fee,
          createdAt: at,
        },
      });
      if (balance > 0n && account.userId) {
        await notify(
          tx,
          account.userId,
          'CARD_STATEMENT',
          `Your ${account.nickname} statement is ready: ${formatCents(toCents(balance))} owed, minimum ${formatCents(toCents(minimum))} due ${dueDate.toISOString().slice(0, 10)}. Pay it in full to avoid interest.`,
          at,
        );
      }
    });
  }
}
