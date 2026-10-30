import { randomInt } from 'node:crypto';
import { formatCents, type CardView, type DemoPurchaseResult } from '@dddbanker/shared';
import { toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../errors';
import type { Account, Card } from '../generated/prisma/client';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';
import { toCents } from '../money';
import { notify, outgoingToday } from './common';

/** Fictional merchants for demo purchases. */
export const MERCHANTS = [
  'Bramblewood Bakery Co.',
  'Thimble & Thread',
  'The Mossy Mug Cafe',
  'Pinecone Books',
  'Hedgerow Grocers',
  'Lantern Lane Cinema',
  'Clover Corner Flowers',
  'Puddle Jump Toys',
];

export function issueDebitCard(tx: Tx, accountId: string, at: Date) {
  return issueCard(tx, accountId, 'DEBIT', at);
}

export async function issueCard(tx: Tx, accountId: string, type: 'DEBIT' | 'CREDIT', at: Date) {
  return tx.card.create({
    data: {
      accountId,
      type,
      last4: String(randomInt(0, 10_000)).padStart(4, '0'),
      expiryMonth: at.getUTCMonth() + 1,
      expiryYear: at.getUTCFullYear() + 4,
      createdAt: at,
    },
  });
}

export function toCardView(card: Card & { account: Account }): CardView {
  return {
    id: card.id,
    type: card.type,
    last4: card.last4,
    expiry: `${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear).slice(-2)}`,
    status: card.status,
    accountId: card.accountId,
    accountNickname: card.account.nickname,
    spendingLimitCents: toCents(card.spendingLimitCents),
  };
}

export async function listCards(db: Db, userId: string) {
  const cards = await db.card.findMany({
    where: { account: { userId }, status: { not: 'REPLACED' } },
    include: { account: true },
    orderBy: { createdAt: 'asc' },
  });
  return cards.map(toCardView);
}

async function getOwnedCard(tx: Tx, userId: string, cardId: string) {
  const card = await tx.card.findFirst({
    where: { id: cardId, account: { userId } },
    include: { account: true },
  });
  if (!card) throw notFound('That card');
  return card;
}

type CardAction = 'lock' | 'unlock' | 'report-lost' | 'replace';

/**
 * Change a card's status. Reporting a card lost (or asking for a
 * replacement) retires it for good and issues a new number right away.
 */
export async function changeCardStatus(
  db: Db,
  userId: string,
  cardId: string,
  action: CardAction,
  at: Date,
) {
  return db.$transaction(async (tx) => {
    const card = await getOwnedCard(tx, userId, cardId);
    const usable = card.status === 'ACTIVE' || card.status === 'LOCKED';
    if (!usable) throw new AppError(422, 'CARD_NOT_ACTIVE', 'This card has already been retired.');

    let result: Card & { account: Account };
    let message: string;
    if (action === 'lock' || action === 'unlock') {
      const status = action === 'lock' ? 'LOCKED' : 'ACTIVE';
      result = await tx.card.update({
        where: { id: card.id },
        data: { status },
        include: { account: true },
      });
      message =
        action === 'lock'
          ? `Card ending ${card.last4} is locked. Purchases will be declined until you unlock it.`
          : `Card ending ${card.last4} is unlocked and ready to use.`;
    } else {
      const fresh = await issueCard(tx, card.accountId, card.type, at);
      await tx.card.update({
        where: { id: card.id },
        data: {
          status: action === 'report-lost' ? 'REPORTED_LOST' : 'REPLACED',
          replacedById: fresh.id,
        },
      });
      result = await tx.card.findUniqueOrThrow({
        where: { id: fresh.id },
        include: { account: true },
      });
      message =
        action === 'report-lost'
          ? `Card ending ${card.last4} was reported lost and can't be used. Your new card ends in ${fresh.last4}.`
          : `Your replacement card ending ${fresh.last4} is ready. The old one ending ${card.last4} no longer works.`;
    }

    await audit(tx, {
      userId,
      action: 'CARD_STATUS',
      metadata: { cardId: card.id, action, newCardId: result.id },
      at,
    });
    await notify(tx, userId, 'CARD', message, at);
    return { card: toCardView(result), message };
  });
}

/**
 * Pretend to swipe the card somewhere. Declines (locked card, daily limit,
 * not enough money) are normal outcomes, returned as approved: false.
 */
export async function demoPurchase(
  tx: Tx,
  userId: string,
  cardId: string,
  requested: number | undefined,
  at: Date,
): Promise<DemoPurchaseResult> {
  const card = await getOwnedCard(tx, userId, cardId);
  const merchant = MERCHANTS[randomInt(0, MERCHANTS.length)]!;
  const amountCents = requested ?? randomInt(300, 8_500);
  const decline = (reason: string): DemoPurchaseResult => ({
    approved: false,
    merchant,
    amountCents,
    reason,
  });

  if (card.status !== 'ACTIVE') {
    return decline(
      card.status === 'LOCKED' ? 'This card is locked.' : 'This card is no longer active.',
    );
  }
  const spent = await outgoingToday(tx, [card.accountId], at, { types: ['CARD_PURCHASE'] });
  if (spent + BigInt(amountCents) > card.spendingLimitCents) {
    return decline(
      `It would go over the card's daily spending limit of ${formatCents(toCents(card.spendingLimitCents))}.`,
    );
  }
  if (card.account.type === 'CREDIT_CARD') {
    // Credit: what's left of the limit (balance is negative when owed).
    const available = (card.account.creditLimitCents ?? 0n) + card.account.balanceCents;
    if (available < BigInt(amountCents)) {
      return decline(
        `It would go over your credit limit. Available credit: ${formatCents(toCents(available > 0n ? available : 0n))}.`,
      );
    }
  } else if (card.account.balanceCents < BigInt(amountCents)) {
    return decline(`There isn't enough money in ${card.account.nickname}.`);
  }

  const clearing = await getSystemAccountId(tx, 'EXTERNAL_CLEARING');
  await postTransaction(tx, {
    type: 'CARD_PURCHASE',
    description: `Card purchase at ${merchant}`,
    memo: `Card ending ${card.last4}`,
    channel: 'CARD',
    initiatedByUserId: userId,
    at,
    entries: [
      { accountId: card.accountId, amountCents: -BigInt(amountCents), description: merchant },
      {
        accountId: clearing,
        amountCents: BigInt(amountCents),
        description: `Card ${card.last4} at ${merchant}`,
      },
    ],
  });
  await audit(tx, {
    userId,
    action: 'CARD_PURCHASE',
    metadata: { cardId, amountCents, merchant },
    at,
  });
  const account = await tx.account.findUniqueOrThrow({ where: { id: card.accountId } });
  return { approved: true, merchant, amountCents, account: toAccountSummary(account) };
}
