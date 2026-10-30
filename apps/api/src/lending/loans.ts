import {
  LENDING,
  amortize,
  applyBps,
  formatCents,
  type CalculatorResult,
  type LoanApplicationInput,
  type LoanApplicationView,
  type LoanProduct,
  type LoanView,
  type ScheduleRow,
} from '@dddbanker/shared';
import type { z } from 'zod';
import type { acceptOfferSchema, loanPaymentSchema } from '@dddbanker/shared';
import { getOwnedAccount, openAccount } from '../accounts/accounts';
import { audit } from '../audit';
import { addMonths, notify, requireDepositAccount } from '../banking/common';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../errors';
import type { Account, Loan, LoanApplication } from '../generated/prisma/client';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { toCents } from '../money';
import { openCreditCard } from './creditCards';
import { underwrite } from './underwriting';

const OFFER_DAYS = 30;
const LATE_FEE = 2_500n;
const ACCOUNT_TYPE = {
  AUTO: 'AUTO_LOAN',
  MORTGAGE: 'MORTGAGE',
  PERSONAL: 'PERSONAL_LOAN',
} as const;
const NOUN = { AUTO: 'auto loan', MORTGAGE: 'home loan', PERSONAL: 'personal loan' } as const;

// ---------- Applications ----------

/** Monthly payments the customer already owes this bank: loans, plus 2% of card balances. */
async function existingMonthlyDebt(tx: Tx, userId: string) {
  const loans = await tx.loan.findMany({
    where: { status: 'ACTIVE', account: { userId } },
    select: { monthlyPaymentCents: true },
  });
  const cards = await tx.account.findMany({
    where: { userId, type: 'CREDIT_CARD', status: 'OPEN' },
    select: { balanceCents: true },
  });
  const loanTotal = loans.reduce((sum, l) => sum + Number(l.monthlyPaymentCents), 0);
  const cardTotal = cards.reduce(
    (sum, c) => sum + Math.max(0, Math.round(-Number(c.balanceCents) * 0.02)),
    0,
  );
  return loanTotal + cardTotal;
}

export function toApplicationView(app: LoanApplication, now: Date): LoanApplicationView {
  const offer =
    app.decision === 'DECLINED' || app.offeredAmountCents === null
      ? null
      : {
          amountCents: toCents(app.offeredAmountCents),
          termMonths: app.offeredTermMonths ?? 0,
          rateBps: app.offeredRateBps ?? 0,
          monthlyPaymentCents: toCents(app.offeredMonthlyPaymentCents ?? 0n),
          ...(app.product === 'CREDIT_CARD'
            ? { creditLimitCents: toCents(app.offeredAmountCents) }
            : {}),
        };
  const status =
    app.decision === 'DECLINED'
      ? 'DECLINED'
      : app.acceptedAt
        ? 'ACCEPTED'
        : app.expiresAt <= now
          ? 'EXPIRED'
          : 'OFFER';
  return {
    id: app.id,
    product: app.product,
    decision: app.decision,
    status,
    reason: app.decisionReason,
    requestedAmountCents: toCents(app.requestedAmountCents),
    priceCents: (JSON.parse(app.details) as { priceCents?: number }).priceCents ?? null,
    termMonths: app.termMonths,
    offer,
    createdAt: app.createdAt.toISOString(),
    expiresAt: app.expiresAt.toISOString(),
  };
}

/** Apply, and get an instant (simulated) decision. */
export async function applyForCredit(
  db: Db,
  userId: string,
  input: LoanApplicationInput,
  at: Date,
) {
  return db.$transaction(async (tx) => {
    const pending = await tx.loanApplication.count({
      where: { userId, decision: { not: 'DECLINED' }, acceptedAt: null, expiresAt: { gt: at } },
    });
    if (pending >= 5)
      throw new AppError(
        422,
        'LIMIT_EXCEEDED',
        'You have 5 open offers. Accept or let one expire before applying again.',
      );

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const debt = input.monthlyDebtCents + (await existingMonthlyDebt(tx, userId));

    const amountCents =
      input.product === 'PERSONAL'
        ? input.amountCents
        : input.product === 'CREDIT_CARD'
          ? 0
          : Math.max(0, input.priceCents - input.downPaymentCents);
    if (
      (input.product === 'AUTO' || input.product === 'MORTGAGE') &&
      input.downPaymentCents >= input.priceCents
    ) {
      throw new AppError(
        400,
        'VALIDATION',
        'Your down payment covers the whole price, so you would not need a loan.',
        {
          downPaymentCents: 'Make this less than the price',
        },
      );
    }
    const termMonths = input.product === 'CREDIT_CARD' ? 0 : input.termMonths;

    const result = underwrite({
      product: input.product,
      creditScore: user.creditScore,
      annualIncomeCents: input.annualIncomeCents,
      monthlyDebtCents: debt,
      amountCents,
      termMonths,
      year: at.getUTCFullYear(),
      ...('priceCents' in input
        ? { priceCents: input.priceCents, downPaymentCents: input.downPaymentCents }
        : {}),
      ...('vehicleYear' in input ? { vehicleYear: input.vehicleYear } : {}),
    });

    const app = await tx.loanApplication.create({
      data: {
        userId,
        product: input.product,
        requestedAmountCents: BigInt(amountCents),
        termMonths,
        details: JSON.stringify(input),
        decision: result.decision,
        decisionReason: result.reason,
        offeredAmountCents: result.offer ? BigInt(result.offer.amountCents) : null,
        offeredTermMonths: result.offer?.termMonths ?? null,
        offeredRateBps: result.offer?.rateBps ?? null,
        offeredMonthlyPaymentCents: result.offer ? BigInt(result.offer.monthlyPaymentCents) : null,
        createdAt: at,
        expiresAt: new Date(at.getTime() + OFFER_DAYS * 86_400_000),
      },
    });
    await audit(tx, {
      userId,
      action: 'APPLICATION',
      metadata: { applicationId: app.id, product: input.product, decision: result.decision },
      at,
    });
    return toApplicationView(app, at);
  });
}

export async function listApplications(db: Db, userId: string, now: Date) {
  const apps = await db.loanApplication.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return apps.map((a) => toApplicationView(a, now));
}

type AcceptInput = z.output<typeof acceptOfferSchema>;

/** Take an offer: opens the loan (or card) and moves the money. All-or-nothing. */
export async function acceptOffer(
  tx: Tx,
  userId: string,
  applicationId: string,
  input: AcceptInput,
  at: Date,
) {
  const app = await tx.loanApplication.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw notFound('That application');
  if (
    app.decision === 'DECLINED' ||
    app.acceptedAt ||
    app.expiresAt <= at ||
    app.offeredAmountCents === null
  ) {
    throw new AppError(
      422,
      'OFFER_UNAVAILABLE',
      'That offer is no longer available. You can apply again anytime.',
    );
  }
  // Claim it first, so a double submit can't open two loans.
  const { count } = await tx.loanApplication.updateMany({
    where: { id: app.id, acceptedAt: null },
    data: { acceptedAt: at },
  });
  if (count === 0) throw new AppError(422, 'OFFER_UNAVAILABLE', 'That offer was already accepted.');

  if (app.product === 'CREDIT_CARD') {
    const account = await openCreditCard(tx, userId, app, at);
    await tx.loanApplication.update({ where: { id: app.id }, data: { accountId: account.id } });
    return { accountId: account.id, product: app.product };
  }

  const product = app.product as LoanProduct;
  const details = JSON.parse(app.details) as LoanApplicationInput;
  const principal = app.offeredAmountCents;
  const rate = app.offeredRateBps ?? LENDING[product].baseRateBps;
  const term = app.offeredTermMonths ?? app.termMonths;

  const autopay = input.autopayFromAccountId
    ? await getOwnedAccount(tx, userId, input.autopayFromAccountId)
    : null;
  if (autopay) requireDepositAccount(autopay, 'Autopay');

  // Down payment: whatever the loan doesn't cover (a counter-offer can make it bigger).
  if ('priceCents' in details) {
    const down = BigInt(details.priceCents) - principal;
    if (down > 0n) {
      if (!input.downPaymentFromAccountId) {
        throw new AppError(
          400,
          'VALIDATION',
          `Choose where the ${formatCents(Number(down))} down payment comes from.`,
          {
            downPaymentFromAccountId: 'Choose an account',
          },
        );
      }
      const from = await getOwnedAccount(tx, userId, input.downPaymentFromAccountId);
      requireDepositAccount(from, 'A down payment');
      await postTransaction(tx, {
        type: 'LOAN_DISBURSEMENT',
        description: `Down payment for your ${NOUN[product]}`,
        channel: 'TELLER',
        initiatedByUserId: userId,
        at,
        entries: [
          { accountId: from.id, amountCents: -down, description: `Down payment: ${NOUN[product]}` },
          {
            accountId: await getSystemAccountId(tx, 'EXTERNAL_CLEARING'),
            amountCents: down,
            description: `Down payment from ${from.number}`,
          },
        ],
      });
    }
  }

  const account = await openAccount(tx, { userId, type: ACCOUNT_TYPE[product], at });
  await tx.account.update({ where: { id: account.id }, data: { interestRateBps: rate } });

  // Personal loans land in checking; car and home loans pay the dealer or seller.
  const checking = await tx.account.findFirst({
    where: { userId, type: 'CHECKING', status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
  });
  const toCustomer = product === 'PERSONAL' && checking;
  const destination = toCustomer ? checking.id : await getSystemAccountId(tx, 'EXTERNAL_CLEARING');
  const paidTo = {
    AUTO: 'the dealership',
    MORTGAGE: 'the seller at closing',
    PERSONAL: 'your checking',
  }[product];
  await postTransaction(tx, {
    type: 'LOAN_DISBURSEMENT',
    description: `${account.nickname} funded`,
    channel: 'SYSTEM',
    initiatedByUserId: userId,
    at,
    entries: [
      {
        accountId: account.id,
        amountCents: -principal,
        description: `Loan funded: paid to ${paidTo}`,
      },
      {
        accountId: destination,
        amountCents: principal,
        description: toCustomer ? `${account.nickname} funds` : `${account.nickname} for ${userId}`,
      },
    ],
  });

  await tx.loan.create({
    data: {
      accountId: account.id,
      product,
      principalCents: principal,
      rateBps: rate,
      termMonths: term,
      monthlyPaymentCents: app.offeredMonthlyPaymentCents ?? 0n,
      startDate: at,
      nextDueDate: addMonths(at, 1),
      autopayFromAccountId: autopay?.id ?? null,
      createdAt: at,
    },
  });
  await tx.loanApplication.update({ where: { id: app.id }, data: { accountId: account.id } });
  await audit(tx, {
    userId,
    action: 'LOAN_ACCEPTED',
    metadata: { applicationId: app.id, accountId: account.id },
    at,
  });
  await notify(
    tx,
    userId,
    'LOAN',
    `Your ${NOUN[product]} of ${formatCents(toCents(principal))} is open. First payment of ${formatCents(toCents(app.offeredMonthlyPaymentCents ?? 0n))} is due ${addMonths(at, 1).toISOString().slice(0, 10)}.`,
    at,
  );
  return { accountId: account.id, product: app.product };
}

// ---------- Loans ----------

export function toLoanView(
  loan: Loan & { account: Account },
  autopayFrom: string | null,
): LoanView {
  return {
    accountId: loan.accountId,
    product: loan.product as LoanProduct,
    nickname: loan.account.nickname,
    maskedNumber: `••••${loan.account.number.slice(-4)}`,
    principalCents: toCents(loan.principalCents),
    balanceOwedCents: toCents(-loan.account.balanceCents),
    rateBps: loan.rateBps,
    termMonths: loan.termMonths,
    monthlyPaymentCents: toCents(loan.monthlyPaymentCents),
    nextDueDate: loan.nextDueDate.toISOString(),
    amountDueCents: toCents(loan.amountDueCents),
    installmentsBilled: loan.installmentsBilled,
    autopayFrom,
    status: loan.status,
  };
}

async function viewOf(tx: Db | Tx, loan: Loan & { account: Account }) {
  const autopay = loan.autopayFromAccountId
    ? await tx.account.findUnique({ where: { id: loan.autopayFromAccountId } })
    : null;
  return toLoanView(loan, autopay?.nickname ?? null);
}

async function getOwnedLoan(tx: Db | Tx, userId: string, accountId: string) {
  const loan = await tx.loan.findFirst({
    where: { accountId, account: { userId } },
    include: { account: true },
  });
  if (!loan) throw notFound('That loan');
  return loan;
}

export async function listLoans(db: Db, userId: string) {
  const loans = await db.loan.findMany({
    where: { account: { userId } },
    include: { account: true },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(loans.map((l) => viewOf(db, l)));
}

export async function getLoan(db: Db, userId: string, accountId: string) {
  return viewOf(db, await getOwnedLoan(db, userId, accountId));
}

/** The road ahead: remaining payments at the current balance, rate, and payment. */
export async function loanSchedule(
  db: Db,
  userId: string,
  accountId: string,
): Promise<ScheduleRow[]> {
  const loan = await getOwnedLoan(db, userId, accountId);
  if (loan.status !== 'ACTIVE') return [];
  const owed = toCents(-loan.account.balanceCents);
  const remaining = Math.max(1, loan.termMonths - loan.installmentsBilled);
  const { rows } = amortize(owed, loan.rateBps, remaining, toCents(loan.monthlyPaymentCents));
  return rows.map((r) => ({ ...r, dueDate: addMonths(loan.nextDueDate, r.n - 1).toISOString() }));
}

type PaymentInput = z.output<typeof loanPaymentSchema>;

/** Pay toward a loan. Anything beyond what's due goes straight to principal. */
export async function payLoan(
  tx: Tx,
  userId: string,
  accountId: string,
  input: PaymentInput,
  at: Date,
  channel = 'ONLINE',
) {
  const loan = await getOwnedLoan(tx, userId, accountId);
  if (loan.status !== 'ACTIVE')
    throw new AppError(422, 'ACCOUNT_NOT_OPEN', 'This loan is already paid off.');
  const owed = -loan.account.balanceCents;
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
  requireDepositAccount(from, 'Loan payments');
  const amount = BigInt(input.amountCents);
  await postTransaction(tx, {
    type: 'LOAN_PAYMENT',
    description: `Payment to ${loan.account.nickname}`,
    channel,
    initiatedByUserId: userId,
    at,
    entries: [
      {
        accountId: from.id,
        amountCents: -amount,
        description: `Payment: ${loan.account.nickname}`,
      },
      {
        accountId: loan.accountId,
        amountCents: amount,
        description: `Payment from ${from.nickname}`,
      },
    ],
  });

  const paidOff = amount === owed;
  const due = loan.amountDueCents > amount ? loan.amountDueCents - amount : 0n;
  await tx.loan.update({
    where: { id: loan.id },
    data: {
      amountDueCents: paidOff ? 0n : due,
      ...(paidOff ? { status: 'PAID_OFF', autopayFromAccountId: null } : {}),
    },
  });
  if (paidOff) {
    await tx.account.update({
      where: { id: loan.accountId },
      data: { status: 'CLOSED', closedAt: at },
    });
    await notify(
      tx,
      userId,
      'LOAN',
      `🎉 ${loan.account.nickname} is paid off! Congratulations.`,
      at,
    );
  }
  await audit(tx, {
    userId,
    action: 'LOAN_PAYMENT',
    metadata: { accountId, amountCents: input.amountCents },
    at,
  });
  return viewOf(tx, await getOwnedLoan(tx, userId, accountId));
}

/**
 * Bill every loan due by `dayEnd`: charge the month's interest, add a late
 * fee if last month's bill wasn't paid, bill the installment, then try
 * autopay. Each loan's due date advances in the same transaction as its
 * charges, so re-running can't bill twice.
 */
export async function billLoans(db: Db, dayEnd: Date, at: Date) {
  const due = await db.loan.findMany({
    where: { status: 'ACTIVE', nextDueDate: { lte: dayEnd } },
    include: { account: true },
  });
  for (const loan of due) {
    const userId = loan.account.userId!;
    const billed = await db.$transaction(async (tx) => {
      const { count } = await tx.loan.updateMany({
        where: { id: loan.id, nextDueDate: loan.nextDueDate, status: 'ACTIVE' },
        data: { nextDueDate: addMonths(loan.nextDueDate, 1), installmentsBilled: { increment: 1 } },
      });
      if (count === 0) return null;

      const owed = toCents(-loan.account.balanceCents);
      const interest = BigInt(applyBps(owed, loan.rateBps, 12));
      if (interest > 0n) {
        await postTransaction(tx, {
          type: 'INTEREST',
          description: 'Loan interest',
          channel: 'SYSTEM',
          at,
          entries: [
            {
              accountId: loan.accountId,
              amountCents: -interest,
              description: 'Interest for the month',
            },
            {
              accountId: await getSystemAccountId(tx, 'INTEREST_INCOME'),
              amountCents: interest,
              description: `Interest on ${loan.account.number}`,
            },
          ],
        });
      }
      let fee = 0n;
      if (loan.amountDueCents > 0n) {
        fee = LATE_FEE;
        await postTransaction(tx, {
          type: 'FEE',
          description: 'Late payment fee',
          channel: 'SYSTEM',
          at,
          entries: [
            { accountId: loan.accountId, amountCents: -fee, description: 'Late payment fee' },
            {
              accountId: await getSystemAccountId(tx, 'FEES_INCOME'),
              amountCents: fee,
              description: `Late fee on ${loan.account.number}`,
            },
          ],
        });
        await notify(
          tx,
          userId,
          'LOAN_LATE',
          `Your ${loan.account.nickname} payment was late, so a ${formatCents(Number(fee))} fee was added.`,
          at,
        );
      }
      const owedNow = BigInt(owed) + interest + fee;
      const installment = loan.monthlyPaymentCents < owedNow ? loan.monthlyPaymentCents : owedNow;
      const amountDue =
        loan.amountDueCents + fee + installment > owedNow
          ? owedNow
          : loan.amountDueCents + fee + installment;
      await tx.loan.update({ where: { id: loan.id }, data: { amountDueCents: amountDue } });
      return amountDue;
    });
    if (billed === null || billed === 0n) continue;

    if (loan.autopayFromAccountId) {
      try {
        await db.$transaction((tx) =>
          payLoan(
            tx,
            userId,
            loan.accountId,
            { fromAccountId: loan.autopayFromAccountId!, amountCents: toCents(billed) },
            at,
            'SCHEDULED',
          ),
        );
        await notify(
          db,
          userId,
          'LOAN',
          `Autopay paid ${formatCents(toCents(billed))} toward ${loan.account.nickname}.`,
          at,
        );
      } catch {
        await notify(
          db,
          userId,
          'LOAN_LATE',
          `Autopay for ${loan.account.nickname} didn't go through. ${formatCents(toCents(billed))} is due now.`,
          at,
        );
      }
    } else {
      await notify(
        db,
        userId,
        'LOAN',
        `Your ${loan.account.nickname} payment of ${formatCents(toCents(billed))} is due.`,
        at,
      );
    }
  }
}

// ---------- Calculators ----------

export function calculate(
  product: 'AUTO' | 'MORTGAGE',
  priceCents: number,
  downPaymentCents: number,
  termMonths: number,
  rateBps?: number,
): CalculatorResult {
  const loanAmount = Math.max(0, priceCents - downPaymentCents);
  const rate = rateBps ?? LENDING[product].baseRateBps;
  const plan = amortize(loanAmount, rate, termMonths);
  return {
    loanAmountCents: loanAmount,
    rateBps: rate,
    termMonths,
    monthlyPaymentCents: plan.paymentCents,
    totalInterestCents: plan.totalInterestCents,
    totalPaidCents: plan.totalPaidCents,
  };
}
