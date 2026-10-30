import { randomInt } from 'node:crypto';
import {
  formatCents,
  type InsuranceQuoteInput,
  type PolicyView,
  type QuoteView,
} from '@dddbanker/shared';
import { getOwnedAccount } from '../accounts/accounts';
import { audit } from '../audit';
import { addMonths, notify, requireDepositAccount } from '../banking/common';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../errors';
import type { InsurancePolicy, InsuranceQuote } from '../generated/prisma/client';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { toCents } from '../money';
import { priceQuote } from './pricing';

const QUOTE_DAYS = 30;
const TYPE_LABEL = { AUTO: 'Auto', HOME: 'Home', RENTERS: 'Renters', LIFE: 'Life' } as const;

function toQuoteView(q: InsuranceQuote): QuoteView {
  const details = JSON.parse(q.details) as { summary: string };
  return {
    id: q.id,
    type: q.type,
    summary: details.summary,
    coverageCents: toCents(q.coverageCents),
    monthlyPremiumCents: toCents(q.monthlyPremiumCents),
    expiresAt: q.expiresAt.toISOString(),
    bound: q.boundAt !== null,
  };
}

async function toPolicyView(db: Db | Tx, p: InsurancePolicy): Promise<PolicyView> {
  const from = await db.account.findUnique({ where: { id: p.payFromAccountId } });
  return {
    id: p.id,
    number: p.number,
    type: p.type,
    coverageCents: toCents(p.coverageCents),
    monthlyPremiumCents: toCents(p.monthlyPremiumCents),
    status: p.status,
    nextPremiumDate: p.nextPremiumDate.toISOString(),
    payFrom: from?.nickname ?? 'Unknown account',
  };
}

export async function createQuote(db: Db, userId: string, input: InsuranceQuoteInput, at: Date) {
  const priced = priceQuote(input, at.getUTCFullYear());
  const quote = await db.insuranceQuote.create({
    data: {
      userId,
      type: input.type,
      details: JSON.stringify({ ...input, summary: priced.summary }),
      coverageCents: BigInt(priced.coverageCents),
      monthlyPremiumCents: BigInt(priced.monthlyPremiumCents),
      createdAt: at,
      expiresAt: new Date(at.getTime() + QUOTE_DAYS * 86_400_000),
    },
  });
  return toQuoteView(quote);
}

export async function listQuotes(db: Db, userId: string, now: Date) {
  const quotes = await db.insuranceQuote.findMany({
    where: { userId, boundAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return quotes.map(toQuoteView);
}

export async function listPolicies(db: Db, userId: string) {
  const policies = await db.insurancePolicy.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(policies.map((p) => toPolicyView(db, p)));
}

async function chargePremium(tx: Tx, policy: InsurancePolicy, at: Date) {
  await postTransaction(tx, {
    type: 'BILL_PAY',
    description: `${TYPE_LABEL[policy.type]} insurance premium`,
    channel: 'SCHEDULED',
    initiatedByUserId: policy.userId,
    at,
    entries: [
      {
        accountId: policy.payFromAccountId,
        amountCents: -policy.monthlyPremiumCents,
        description: `Bramble Mutual premium (${policy.number})`,
      },
      {
        accountId: await getSystemAccountId(tx, 'INSURANCE'),
        amountCents: policy.monthlyPremiumCents,
        description: `Premium for ${policy.number}`,
      },
    ],
  });
}

/** Turn a quote into a policy. The first month's premium is paid now. */
export async function bindQuote(
  tx: Tx,
  userId: string,
  quoteId: string,
  payFromAccountId: string,
  at: Date,
) {
  const quote = await tx.insuranceQuote.findFirst({ where: { id: quoteId, userId } });
  if (!quote) throw notFound('That quote');
  if (quote.boundAt || quote.expiresAt <= at) {
    throw new AppError(
      422,
      'OFFER_UNAVAILABLE',
      'That quote is no longer available. Ask for a fresh one.',
    );
  }
  const { count } = await tx.insuranceQuote.updateMany({
    where: { id: quote.id, boundAt: null },
    data: { boundAt: at },
  });
  if (count === 0) throw new AppError(422, 'OFFER_UNAVAILABLE', 'That quote was already used.');

  const from = await getOwnedAccount(tx, userId, payFromAccountId);
  requireDepositAccount(from, 'Insurance premiums');
  const policy = await tx.insurancePolicy.create({
    data: {
      userId,
      quoteId: quote.id,
      type: quote.type,
      number: `BM-${String(randomInt(0, 100_000_000)).padStart(8, '0')}`,
      coverageCents: quote.coverageCents,
      monthlyPremiumCents: quote.monthlyPremiumCents,
      payFromAccountId: from.id,
      nextPremiumDate: addMonths(at, 1),
      createdAt: at,
    },
  });
  await chargePremium(tx, policy, at);
  await audit(tx, {
    userId,
    action: 'POLICY_BOUND',
    metadata: { policyId: policy.id, quoteId: quote.id },
    at,
  });
  await notify(
    tx,
    userId,
    'INSURANCE',
    `Your ${TYPE_LABEL[policy.type].toLowerCase()} policy ${policy.number} is active. ${formatCents(toCents(policy.monthlyPremiumCents))} a month from ${from.nickname}.`,
    at,
  );
  return toPolicyView(tx, policy);
}

export async function cancelPolicy(db: Db, userId: string, policyId: string, at: Date) {
  const { count } = await db.insurancePolicy.updateMany({
    where: { id: policyId, userId, status: { not: 'CANCELLED' } },
    data: { status: 'CANCELLED', cancelledAt: at },
  });
  if (count === 0) throw notFound('That active policy');
  await audit(db, { userId, action: 'POLICY_CANCELLED', metadata: { policyId }, at });
}

/**
 * Charge premiums due by `dayEnd`. A missed premium makes the policy past
 * due; missing the next one too cancels it.
 */
export async function chargePremiums(db: Db, dayEnd: Date, at: Date) {
  const due = await db.insurancePolicy.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, nextPremiumDate: { lte: dayEnd } },
  });
  for (const policy of due) {
    const claim = { id: policy.id, nextPremiumDate: policy.nextPremiumDate };
    const next = addMonths(policy.nextPremiumDate, 1);
    try {
      await db.$transaction(async (tx) => {
        const { count } = await tx.insurancePolicy.updateMany({
          where: claim,
          data: { nextPremiumDate: next, status: 'ACTIVE' },
        });
        if (count === 0) return;
        await chargePremium(tx, policy, at);
      });
    } catch {
      const lapsed = policy.status === 'PAST_DUE';
      const { count } = await db.insurancePolicy.updateMany({
        where: claim,
        data: {
          nextPremiumDate: next,
          status: lapsed ? 'CANCELLED' : 'PAST_DUE',
          ...(lapsed ? { cancelledAt: at } : {}),
        },
      });
      if (count > 0) {
        await notify(
          db,
          policy.userId,
          'INSURANCE',
          lapsed
            ? `Policy ${policy.number} lapsed after two missed premiums.`
            : `The premium for policy ${policy.number} didn't go through. Please add money before next month or the policy will lapse.`,
          at,
        );
      }
    }
  }
}
