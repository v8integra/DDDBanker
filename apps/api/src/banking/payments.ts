import {
  LIMITS,
  formatCents,
  type BillPaymentInput,
  type MoneyMoveResult,
  type P2PInput,
  type P2PResult,
  type Payee,
  type PayeeInput,
  type ScheduledPaymentInput,
  type ScheduledPaymentView,
} from '@dddbanker/shared';
import { getOwnedAccount, toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../errors';
import type { Payee as PayeeRow } from '../generated/prisma/client';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { toCents } from '../money';
import { transferBetweenOwnAccounts } from '../transfers/transfers';
import {
  addMonths,
  assertWithinLimit,
  bankDate,
  notify,
  outgoingToday,
  requireDepositAccount,
} from './common';

// ---------- Send money to another customer ----------

export async function sendToPerson(
  tx: Tx,
  sender: { id: string; name: string; email: string },
  input: P2PInput & { toEmail: string },
  at: Date,
): Promise<P2PResult> {
  const from = await getOwnedAccount(tx, sender.id, input.fromAccountId);
  requireDepositAccount(from, 'Sending money');

  if (input.toEmail === sender.email) {
    throw new AppError(
      422,
      'TRANSFER_NOT_ALLOWED',
      'To move money between your own accounts, use a transfer.',
    );
  }
  const recipient = await tx.user.findUnique({
    where: { email: input.toEmail },
    include: {
      accounts: {
        where: { type: 'CHECKING', status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });
  const to = recipient?.accounts[0];
  if (!recipient || !to) {
    throw new AppError(
      404,
      'NOT_FOUND',
      "We couldn't find a Bank of Bramblewood customer with that email.",
      {
        toEmail: 'No customer with that email',
      },
    );
  }

  const spent = await outgoingToday(tx, [from.id], at, { types: ['P2P'] });
  assertWithinLimit(spent, input.amountCents, LIMITS.p2pDailyCents, 'send-money');

  const amount = BigInt(input.amountCents);
  const transactionId = await postTransaction(tx, {
    type: 'P2P',
    description: `${sender.name} to ${recipient.name}`,
    memo: input.memo,
    channel: 'ONLINE',
    initiatedByUserId: sender.id,
    at,
    entries: [
      { accountId: from.id, amountCents: -amount, description: `Sent to ${recipient.name}` },
      { accountId: to.id, amountCents: amount, description: `From ${sender.name}` },
    ],
  });

  await audit(tx, {
    userId: sender.id,
    action: 'P2P',
    metadata: { transactionId, to: recipient.id, amountCents: input.amountCents },
    at,
  });
  await notify(
    tx,
    recipient.id,
    'P2P_RECEIVED',
    `${sender.name} sent you ${formatCents(input.amountCents)}${input.memo ? `: "${input.memo}"` : ''}.`,
    at,
  );
  await notify(
    tx,
    sender.id,
    'P2P_SENT',
    `You sent ${formatCents(input.amountCents)} to ${recipient.name}.`,
    at,
  );

  return {
    transactionId,
    from: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: from.id } })),
    recipientName: recipient.name,
  };
}

// ---------- Payees and bill pay ----------

export function toPayeeView(p: PayeeRow): Payee {
  return {
    id: p.id,
    name: p.name,
    maskedRef: `••••${p.accountRef.replace(/\s|-/g, '').slice(-4)}`,
  };
}

export async function listPayees(db: Db, userId: string) {
  const rows = await db.payee.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  return rows.map(toPayeeView);
}

export async function addPayee(db: Db, userId: string, input: PayeeInput, at: Date) {
  const count = await db.payee.count({ where: { userId } });
  if (count >= 25) throw new AppError(422, 'LIMIT_EXCEEDED', 'You can save up to 25 payees.');
  const payee = await db.payee.create({
    data: { userId, name: input.name, accountRef: input.accountRef, createdAt: at },
  });
  await audit(db, { userId, action: 'PAYEE_ADDED', metadata: { payeeId: payee.id }, at });
  return toPayeeView(payee);
}

export async function removePayee(db: Db, userId: string, payeeId: string, at: Date) {
  const { count } = await db.payee.deleteMany({ where: { id: payeeId, userId } });
  if (count === 0) throw notFound('That payee');
  await audit(db, { userId, action: 'PAYEE_REMOVED', metadata: { payeeId }, at });
}

async function getOwnedPayee(tx: Tx, userId: string, payeeId: string) {
  const payee = await tx.payee.findFirst({ where: { id: payeeId, userId } });
  if (!payee) throw notFound('That payee');
  return payee;
}

export async function payBill(
  tx: Tx,
  userId: string,
  input: BillPaymentInput,
  at: Date,
  channel = 'ONLINE',
): Promise<MoneyMoveResult> {
  const from = await getOwnedAccount(tx, userId, input.fromAccountId);
  requireDepositAccount(from, 'Bill pay');
  const payee = await getOwnedPayee(tx, userId, input.payeeId);
  const clearing = await getSystemAccountId(tx, 'EXTERNAL_CLEARING');

  const transactionId = await postTransaction(tx, {
    type: 'BILL_PAY',
    description: `Bill payment to ${payee.name}`,
    memo: input.memo,
    channel,
    initiatedByUserId: userId,
    at,
    entries: [
      {
        accountId: from.id,
        amountCents: -BigInt(input.amountCents),
        description: `Bill payment: ${payee.name}`,
      },
      {
        accountId: clearing,
        amountCents: BigInt(input.amountCents),
        description: `Bill payment to ${payee.name} (${payee.accountRef})`,
      },
    ],
  });
  await audit(tx, {
    userId,
    action: 'BILL_PAY',
    metadata: { transactionId, payeeId: payee.id, amountCents: input.amountCents },
    at,
  });
  await notify(
    tx,
    userId,
    'BILL_PAID',
    `Paid ${formatCents(input.amountCents)} to ${payee.name}.`,
    at,
  );
  return {
    transactionId,
    account: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: from.id } })),
  };
}

// ---------- Scheduled payments ----------

const startOfDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

export async function createScheduledPayment(
  db: Db,
  userId: string,
  input: ScheduledPaymentInput,
  at: Date,
) {
  if (input.startDate < bankDate(at)) {
    throw new AppError(400, 'VALIDATION', 'Choose today or a later date.', {
      startDate: 'Choose today or a later date',
    });
  }
  return db.$transaction(async (tx) => {
    const from = await getOwnedAccount(tx, userId, input.fromAccountId);
    requireDepositAccount(from, 'Scheduled payments');
    if (input.payeeId) await getOwnedPayee(tx, userId, input.payeeId);
    if (input.toAccountId) {
      const to = await getOwnedAccount(tx, userId, input.toAccountId);
      requireDepositAccount(to, 'Scheduled transfers');
      if (to.id === from.id)
        throw new AppError(400, 'VALIDATION', 'Choose two different accounts.', {
          toAccountId: 'Choose a different account',
        });
    }
    const row = await tx.scheduledPayment.create({
      data: {
        userId,
        fromAccountId: from.id,
        payeeId: input.payeeId ?? null,
        toAccountId: input.toAccountId ?? null,
        amountCents: BigInt(input.amountCents),
        frequency: input.frequency,
        nextRunDate: startOfDate(input.startDate),
        memo: input.memo ?? null,
        createdAt: at,
      },
    });
    await audit(tx, {
      userId,
      action: 'SCHEDULED_PAYMENT',
      metadata: { id: row.id, created: true },
      at,
    });
    return row.id;
  });
}

export async function listScheduledPayments(
  db: Db,
  userId: string,
): Promise<ScheduledPaymentView[]> {
  const rows = await db.scheduledPayment.findMany({
    where: { userId },
    include: { fromAccount: true, toAccount: true, payee: true },
    orderBy: [{ active: 'desc' }, { nextRunDate: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    from: r.fromAccount.nickname,
    to: r.payee?.name ?? r.toAccount?.nickname ?? 'Unknown',
    amountCents: toCents(r.amountCents),
    frequency: r.frequency,
    nextRunDate: r.nextRunDate.toISOString().slice(0, 10),
    active: r.active,
    lastResult: r.lastResult,
  }));
}

export async function cancelScheduledPayment(db: Db, userId: string, id: string, at: Date) {
  const { count } = await db.scheduledPayment.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('That scheduled payment');
  await audit(db, { userId, action: 'SCHEDULED_PAYMENT', metadata: { id, cancelled: true }, at });
}

function nextRun(from: Date, frequency: 'ONCE' | 'WEEKLY' | 'MONTHLY') {
  if (frequency === 'WEEKLY') return new Date(from.getTime() + 7 * 86_400_000);
  if (frequency === 'MONTHLY') return addMonths(from, 1);
  return from;
}

/**
 * Run every scheduled payment that's due. Each run claims its row first
 * (conditional update on nextRunDate), so two schedulers can't double-pay.
 * A failed run (e.g. not enough money) is skipped, recorded, and the
 * customer is told; the schedule moves on to its next date.
 */
export async function runDueScheduledPayments(db: Db, now: Date) {
  const due = await db.scheduledPayment.findMany({
    where: { active: true, nextRunDate: { lte: now } },
    include: { user: true, payee: true },
    orderBy: { nextRunDate: 'asc' },
    take: 200,
  });

  let posted = 0;
  for (const job of due) {
    const advance = {
      nextRunDate: nextRun(job.nextRunDate, job.frequency),
      active: job.frequency !== 'ONCE',
      lastRunAt: now,
    };
    const claim = { id: job.id, nextRunDate: job.nextRunDate, active: true };
    const amount = toCents(job.amountCents);
    const label = job.payee ? `bill payment to ${job.payee.name}` : 'scheduled transfer';

    try {
      await db.$transaction(async (tx) => {
        const { count } = await tx.scheduledPayment.updateMany({
          where: claim,
          data: { ...advance, lastResult: 'POSTED' },
        });
        if (count === 0) return; // someone else ran it
        if (job.payeeId) {
          await payBill(
            tx,
            job.userId,
            {
              payeeId: job.payeeId,
              fromAccountId: job.fromAccountId,
              amountCents: amount,
              memo: job.memo ?? undefined,
            },
            now,
            'SCHEDULED',
          );
        } else if (job.toAccountId) {
          await transferBetweenOwnAccounts(tx, {
            userId: job.userId,
            fromAccountId: job.fromAccountId,
            toAccountId: job.toAccountId,
            amountCents: amount,
            memo: job.memo ?? undefined,
            at: now,
          });
          await notify(
            tx,
            job.userId,
            'SCHEDULED_POSTED',
            `Your scheduled transfer of ${formatCents(amount)} went through.`,
            now,
          );
        }
        posted++;
      });
    } catch (err) {
      const reason = err instanceof AppError ? err.code : 'ERROR';
      const { count } = await db.scheduledPayment.updateMany({
        where: claim,
        data: { ...advance, lastResult: reason },
      });
      if (count > 0) {
        await notify(
          db,
          job.userId,
          'SCHEDULED_FAILED',
          `Your ${label} of ${formatCents(amount)} didn't go through${reason === 'INSUFFICIENT_FUNDS' ? " because there wasn't enough money" : ''}.`,
          now,
        );
      }
    }
  }
  return { due: due.length, posted };
}
