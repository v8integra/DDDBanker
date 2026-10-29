import { formatCents, type CardView } from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import type { StationDef } from '../stations';
import { attempt, speakerOf, type BankContext } from './kit';

const STATUS_LABEL: Record<CardView['status'], string> = {
  ACTIVE: '✓ Active',
  LOCKED: '🔒 Locked',
  REPORTED_LOST: '⚠ Reported lost',
  REPLACED: 'Replaced',
};

/** Basil at Card Services. */
export async function cardsDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<'view' | 'manage' | 'credit' | 'bye'>({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'view', label: 'Show my cards' },
        { value: 'manage', label: 'Lock, replace, or try a card' },
        { value: 'credit', label: 'Apply for a credit card' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'Anything else about your cards?';
    if (choice === 'credit') {
      await ctx.ui.dialogue({
        ...staff,
        lines: [
          'Our Bramble credit card launches with the lending desks in the next update. I will save you a seat!',
        ],
      });
      continue;
    }
    const cards = await attempt(ctx, () => ctx.api.getCards());
    if (!cards) return;
    if (choice === 'view') await showCards(ctx, cards);
    if (choice === 'manage') await manageCard(ctx, cards);
  }
}

async function showCards(ctx: BankContext, cards: CardView[]) {
  await ctx.ui.table({
    title: 'Your Cards',
    caption: 'Your cards',
    columns: [
      { label: 'Card' },
      { label: 'Account' },
      { label: 'Expires' },
      { label: 'Status' },
      { label: 'Daily limit', align: 'end' },
    ],
    rows: cards.map((c) => [
      `${c.type === 'DEBIT' ? 'Debit' : 'Credit'} ••••${c.last4}`,
      c.accountNickname,
      c.expiry,
      STATUS_LABEL[c.status],
      formatCents(c.spendingLimitCents),
    ]),
    empty: 'You have no cards yet.',
  });
}

async function manageCard(ctx: BankContext, cards: CardView[]) {
  const usable = cards.filter((c) => c.status === 'ACTIVE' || c.status === 'LOCKED');
  if (usable.length === 0) {
    await ctx.ui.result({
      title: 'No Cards',
      tone: 'info',
      lines: ['You have no active cards to manage.'],
    });
    return;
  }
  const id =
    usable.length === 1
      ? usable[0]!.id
      : await ctx.ui.options({
          title: 'Which Card?',
          choices: usable.map((c) => ({
            value: c.id,
            label: `••••${c.last4}`,
            hint: `${c.accountNickname} · ${STATUS_LABEL[c.status]}`,
          })),
        });
  const card = usable.find((c) => c.id === id);
  if (!card) return;

  const action = await ctx.ui.options<
    'lock' | 'unlock' | 'buy' | 'report-lost' | 'replace' | 'back'
  >({
    title: `Card ••••${card.last4}`,
    text: [`Status: ${STATUS_LABEL[card.status]}`],
    choices: [
      card.status === 'ACTIVE'
        ? { value: 'lock', label: 'Lock card', hint: 'Pause purchases. Unlock anytime.' }
        : { value: 'unlock', label: 'Unlock card' },
      { value: 'buy', label: 'Try a demo purchase', hint: 'Swipe it at a pretend shop.' },
      {
        value: 'report-lost',
        label: 'Report lost or stolen',
        hint: 'Stops this card and sends a new one.',
      },
      { value: 'replace', label: 'Replace a damaged card' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (!action || action === 'back') return;

  if (action === 'buy') {
    if (
      !(await ctx.ui.confirm({
        title: 'Demo Purchase',
        text: [`Swipe card ••••${card.last4} at a random shop around Bramblewood?`],
        confirmLabel: 'Swipe it',
      }))
    )
      return;
    const result = await attempt(ctx, () => ctx.api.demoPurchase(card.id, newIdempotencyKey()));
    if (!result) return;
    await ctx.ui.result(
      result.approved
        ? {
            title: 'Approved',
            tone: 'success',
            lines: [
              `${formatCents(result.amountCents)} at ${result.merchant}.`,
              `${result.account?.nickname} now has ${formatCents(result.account?.balanceCents ?? 0)}.`,
            ],
          }
        : {
            title: 'Declined',
            tone: 'error',
            lines: [
              `${formatCents(result.amountCents)} at ${result.merchant} was declined.`,
              result.reason ?? '',
            ],
          },
    );
    return;
  }

  if (action === 'report-lost' || action === 'replace') {
    const sure = await ctx.ui.confirm({
      title: action === 'report-lost' ? 'Report Lost' : 'Replace Card',
      text: [
        `Card ••••${card.last4} will stop working for good, and you'll get a new card number right away.`,
      ],
      confirmLabel: action === 'report-lost' ? 'Yes, report it' : 'Yes, replace it',
      danger: true,
    });
    if (!sure) return;
  }
  const result = await attempt(ctx, () => ctx.api.cardAction(card.id, action));
  if (!result) return;
  await ctx.ui.result({ title: 'Card Updated', tone: 'success', lines: [result.message] });
  void ctx.watcher.refresh();
}
