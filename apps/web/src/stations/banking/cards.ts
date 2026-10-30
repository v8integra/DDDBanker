import { formatCents, type CardView, type CreditCardAccountView } from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import { balanceCell } from '../../ui/windows/money';
import { FormCancelled } from '../../ui/windows/windows';
import type { StationDef } from '../stations';
import {
  accountOptions,
  attempt,
  emptyErrors,
  formatDate,
  isDepositAccount,
  loadAccounts,
  percent,
  readAmount,
  speakerOf,
  type BankContext,
} from './kit';
import { offersFlow, showDecision } from './lending';

/** Bramble credit card: apply if there's none yet, otherwise view, pay, and see statements. */
async function creditCardFlow(ctx: BankContext) {
  const cards = await attempt(ctx, () => ctx.api.getCreditCards());
  if (!cards) return;
  if (cards.length === 0) {
    const apps = (await attempt(ctx, () => ctx.api.getApplications())) ?? [];
    if (apps.some((a) => a.product === 'CREDIT_CARD' && a.status === 'OFFER')) {
      await offersFlow(ctx, 'CREDIT_CARD');
      return;
    }
    const app = await ctx.ui.form({
      title: 'Apply: Bramble Credit Card',
      intro: [
        'No annual fee, and pay in full each month to never pay interest. You get an answer right away.',
      ],
      fields: [
        {
          name: 'income',
          label: 'Yearly income before taxes',
          type: 'money',
          hint: 'Make it up! This is a demo.',
        },
        {
          name: 'debts',
          label: 'Other monthly debt payments',
          type: 'money',
          value: '0',
          hint: 'Not rent. 0 is fine.',
        },
      ],
      submitLabel: 'Apply',
      validate: (v) => {
        const errors = emptyErrors();
        readAmount(v, 'income', errors);
        return errors;
      },
      submit: (v) =>
        ctx.api.apply({
          product: 'CREDIT_CARD',
          annualIncomeCents: readAmount(v, 'income', emptyErrors())!,
          monthlyDebtCents:
            v.debts?.trim() && v.debts.trim() !== '0'
              ? (readAmount(v, 'debts', emptyErrors()) ?? 0)
              : 0,
        }),
    });
    if (app) await showDecision(ctx, app);
    return;
  }

  let card: CreditCardAccountView | undefined = cards[0];
  while (card) {
    const s = card.latestStatement;
    const pick = await ctx.ui.table<'pay' | 'statements' | 'done'>({
      title: `Bramble Card ${card.cardLast4 ? `••••${card.cardLast4}` : card.maskedNumber}`,
      caption: 'Credit card summary',
      columns: [{ label: 'Detail' }, { label: 'Value', align: 'end' }],
      rows: [
        ['Balance owed', balanceCell(card.balanceOwedCents)],
        ['Available credit', balanceCell(card.availableCents)],
        ['Credit limit', balanceCell(card.creditLimitCents)],
        ['APR', percent(card.aprBps)],
        ...(s
          ? ([
              ['Last statement', balanceCell(s.statementBalanceCents)],
              ['Minimum due', balanceCell(s.minimumDueCents)],
              ['Due by', formatDate(s.dueDate)],
              ['Paid since statement', balanceCell(s.paidCents)],
            ] as [string, ReturnType<typeof balanceCell> | string][])
          : [
              ['Statements', `First one closes on day ${card.statementDay} of the month`] as [
                string,
                string,
              ],
            ]),
      ],
      note: 'Pay the statement balance in full by the due date and no interest is charged.',
      choices: [
        ...(card.balanceOwedCents > 0 ? [{ value: 'pay' as const, label: 'Make a payment' }] : []),
        { value: 'statements', label: 'Statements' },
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick === 'pay') card = (await payCardFlow(ctx, card)) ?? card;
    else if (pick === 'statements') await statementsFlow(ctx, card);
    else return;
  }
}

async function payCardFlow(ctx: BankContext, card: CreditCardAccountView) {
  const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
  if (!accounts) return null;
  const s = card.latestStatement;
  const statementLeft = s ? Math.max(0, s.statementBalanceCents - s.paidCents) : 0;
  const suggested = Math.min(card.balanceOwedCents, statementLeft || card.balanceOwedCents);
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Card Payment',
    fields: [
      { name: 'from', label: 'Pay from', type: 'select', options: accountOptions(accounts) },
      {
        name: 'amount',
        label: 'Amount',
        type: 'money',
        value: (suggested / 100).toFixed(2),
        hint: `${s ? `Minimum ${formatCents(s.minimumDueCents)} · statement ${formatCents(s.statementBalanceCents)} · ` : ''}everything owed ${formatCents(card.balanceOwedCents)}.`,
      },
    ],
    submitLabel: 'Continue',
    validate: (v) => {
      const errors = emptyErrors();
      readAmount(v, 'amount', errors);
      return errors;
    },
    submit: async (v) => {
      const amountCents = readAmount(v, 'amount', emptyErrors())!;
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Payment',
          text: [`Pay ${formatCents(amountCents)} toward your Bramble card?`],
          confirmLabel: 'Yes, pay it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.payCreditCard(card.accountId, v.from!, amountCents, key);
    },
  });
  if (result)
    await ctx.ui.result({
      title: 'Payment Received',
      tone: 'success',
      lines: [`Thank you! You now owe ${formatCents(result.balanceOwedCents)}.`],
    });
  return result;
}

async function statementsFlow(ctx: BankContext, card: CreditCardAccountView) {
  const statements = await attempt(ctx, () => ctx.api.getCardStatements(card.accountId));
  if (!statements) return;
  await ctx.ui.table({
    title: 'Card Statements',
    caption: 'Credit card statements, newest first',
    columns: [
      { label: 'Closed' },
      { label: 'Balance', align: 'end' },
      { label: 'Minimum', align: 'end' },
      { label: 'Due' },
      { label: 'Interest', align: 'end' },
      { label: 'Fees', align: 'end' },
    ],
    rows: statements.map((s) => [
      formatDate(s.periodEnd),
      balanceCell(s.statementBalanceCents),
      balanceCell(s.minimumDueCents),
      formatDate(s.dueDate),
      balanceCell(s.interestCents),
      balanceCell(s.feeCents),
    ]),
    empty: 'No statements yet. The first closes about a month after you open the card.',
  });
}

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
        { value: 'credit', label: 'Bramble credit card' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'Anything else about your cards?';
    if (choice === 'credit') {
      await creditCardFlow(ctx);
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
