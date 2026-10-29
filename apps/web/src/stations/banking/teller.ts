import { CD_TERMS, LIMITS, formatCents, type AccountSummary } from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import { balanceCell, movementCell } from '../../ui/windows/money';
import { FormCancelled } from '../../ui/windows/windows';
import type { StationDef } from '../stations';
import {
  TYPE_LABEL,
  accountChoices,
  accountOptions,
  attempt,
  emptyErrors,
  formatDate,
  isDepositAccount,
  loadAccounts,
  readAmount,
  recentMonths,
  serverNow,
  speakerOf,
  type BankContext,
} from './kit';

type TellerChoice =
  'balances' | 'activity' | 'statements' | 'deposit' | 'withdraw' | 'open' | 'rename' | 'bye';

/** Rowan at the Teller: everything about your accounts. */
export async function tellerDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<TellerChoice>({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'balances', label: 'My balances' },
        { value: 'activity', label: 'Recent activity' },
        { value: 'statements', label: 'Monthly statements' },
        { value: 'deposit', label: 'Make a deposit' },
        { value: 'withdraw', label: 'Withdraw cash' },
        { value: 'open', label: 'Open a savings account or CD' },
        { value: 'rename', label: 'Rename an account' },
        { value: 'bye', label: "That's all, thanks" },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'Anything else I can do for you?';
    const accounts = await loadAccounts(ctx);
    if (!accounts) return;

    if (choice === 'balances') await showBalances(ctx, accounts);
    if (choice === 'activity') await showActivity(ctx, accounts);
    if (choice === 'statements') await showStatement(ctx, accounts);
    if (choice === 'deposit') await depositFlow(ctx, accounts, 'TELLER');
    if (choice === 'withdraw') await withdrawFlow(ctx, accounts);
    if (choice === 'open') await openAccountFlow(ctx, accounts);
    if (choice === 'rename') await renameFlow(ctx, accounts);
  }
}

export async function showBalances(ctx: BankContext, accounts: AccountSummary[]) {
  await ctx.ui.table({
    title: 'Your Balances',
    caption: 'Your accounts and balances',
    columns: [
      { label: 'Account' },
      { label: 'Type' },
      { label: 'Number' },
      { label: 'Rate', align: 'end' },
      { label: 'Balance', align: 'end' },
    ],
    rows: accounts.map((a) => [
      a.nickname,
      TYPE_LABEL[a.type] ?? a.type,
      a.maskedNumber,
      a.interestRateBps ? `${(a.interestRateBps / 100).toFixed(2)}%` : '—',
      balanceCell(a.balanceCents),
    ]),
  });
}

async function pickAccount(ctx: BankContext, accounts: AccountSummary[], title: string) {
  if (accounts.length === 1) return accounts[0]!;
  const id = await ctx.ui.options({ title, choices: accountChoices(accounts) });
  return accounts.find((a) => a.id === id) ?? null;
}

async function showActivity(ctx: BankContext, accounts: AccountSummary[]) {
  const account = await pickAccount(ctx, accounts, 'Which Account?');
  if (!account) return;
  let before: number | undefined;
  for (;;) {
    const page = await attempt(ctx, () => ctx.api.getTransactions(account.id, before));
    if (!page) return;
    const pick = await ctx.ui.table<'older' | 'done'>({
      title: `${account.nickname} Activity`,
      caption: `Recent activity for ${account.nickname}`,
      columns: [
        { label: 'Date' },
        { label: 'Description' },
        { label: 'Amount', align: 'end' },
        { label: 'Balance', align: 'end' },
      ],
      rows: page.items.map((t) => [
        formatDate(t.postedAt),
        t.memo ? `${t.description} (${t.memo})` : t.description,
        movementCell(t.amountCents),
        balanceCell(t.balanceAfterCents),
      ]),
      empty: 'No activity yet.',
      choices: [
        ...(page.nextCursor ? [{ value: 'older' as const, label: 'Show older' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick !== 'older' || !page.nextCursor) return;
    before = page.nextCursor;
  }
}

async function showStatement(ctx: BankContext, accounts: AccountSummary[]) {
  const account = await pickAccount(ctx, accounts, 'Statement For');
  if (!account) return;
  const month = await ctx.ui.options({
    title: 'Which Month?',
    choices: recentMonths(serverNow(ctx)).map((m) => ({ value: m.value, label: m.label })),
  });
  if (!month) return;
  const s = await attempt(ctx, () => ctx.api.getStatement(account.id, month));
  if (!s) return;
  await ctx.ui.detail({
    title: `${account.nickname}: ${recentMonths(serverNow(ctx), 24).find((m) => m.value === month)?.label ?? month}`,
    items: [
      { label: 'Opening balance', value: balanceCell(s.openingBalanceCents) },
      { label: 'Money in', value: movementCell(s.totalCreditsCents) },
      { label: 'Money out', value: movementCell(s.totalDebitsCents) },
      { label: 'Closing balance', value: balanceCell(s.closingBalanceCents) },
      { label: 'Transactions', value: String(s.lines.length) },
    ],
  });
  if (s.lines.length === 0) return;
  await ctx.ui.table({
    title: 'Statement Lines',
    caption: `Transactions in ${month}`,
    columns: [
      { label: 'Date' },
      { label: 'Description' },
      { label: 'Amount', align: 'end' },
      { label: 'Balance', align: 'end' },
    ],
    rows: s.lines.map((l) => [
      formatDate(l.postedAt),
      l.description,
      movementCell(l.amountCents),
      balanceCell(l.balanceAfterCents),
    ]),
  });
}

/** Deposit at the teller or the ATM. */
export async function depositFlow(
  ctx: BankContext,
  accounts: AccountSummary[],
  channel: 'TELLER' | 'ATM',
) {
  const eligible = accounts.filter(isDepositAccount);
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Make a Deposit',
    intro: ['Pretend you are handing over a check or some cash. (No real money, of course!)'],
    fields: [
      { name: 'accountId', label: 'Into', type: 'select', options: accountOptions(eligible) },
      {
        name: 'method',
        label: 'What are you depositing?',
        type: 'select',
        options: [
          { value: 'CHECK', label: 'A check' },
          { value: 'CASH', label: 'Cash' },
        ],
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'money',
        hint: `Up to ${formatCents(LIMITS.depositCents)} at a time.`,
      },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'amount', errors);
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      const account = eligible.find((a) => a.id === values.accountId)!;
      const sure = await ctx.ui.confirm({
        title: 'Confirm Deposit',
        text: [
          `Deposit ${formatCents(amountCents)} (${values.method === 'CHECK' ? 'check' : 'cash'}) into ${account.nickname}?`,
        ],
        confirmLabel: 'Yes, deposit it',
      });
      if (!sure) throw new FormCancelled();
      return ctx.api.deposit(
        { accountId: account.id, amountCents, method: values.method as 'CHECK' | 'CASH', channel },
        key,
      );
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Deposit Posted',
    tone: 'success',
    lines: [
      `Your deposit is in. ${result.account.nickname} now has ${formatCents(result.account.balanceCents)}.`,
    ],
  });
  void ctx.watcher.refresh(); // the bell has a new notification
}

async function withdrawFlow(ctx: BankContext, accounts: AccountSummary[]) {
  const eligible = accounts.filter(isDepositAccount);
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Withdraw Cash',
    fields: [
      { name: 'accountId', label: 'From', type: 'select', options: accountOptions(eligible) },
      { name: 'amount', label: 'Amount', type: 'money' },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'amount', errors);
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      const account = eligible.find((a) => a.id === values.accountId)!;
      const sure = await ctx.ui.confirm({
        title: 'Confirm Withdrawal',
        text: [`Withdraw ${formatCents(amountCents)} in cash from ${account.nickname}?`],
        confirmLabel: 'Yes, withdraw it',
      });
      if (!sure) throw new FormCancelled();
      return ctx.api.withdraw({ accountId: account.id, amountCents, channel: 'TELLER' }, key);
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Here You Go',
    tone: 'success',
    lines: [
      `Rowan counts out your cash. ${result.account.nickname} now has ${formatCents(result.account.balanceCents)}.`,
    ],
  });
}

/** Open savings or a CD. Also used by the Savings desk. */
export async function openAccountFlow(ctx: BankContext, accounts: AccountSummary[]) {
  const kind = await ctx.ui.options<string>({
    title: 'Open an Account',
    text: ['Savings you can use anytime, or a CD that locks your money in for a higher rate.'],
    choices: [
      { value: 'SAVINGS', label: 'Savings account', hint: '3.50% a year · no minimum' },
      ...CD_TERMS.map((t) => ({
        value: `CD:${t.months}`,
        label: `${t.months}-month CD`,
        hint: `${(t.rateBps / 100).toFixed(2)}% a year · ${formatCents(LIMITS.cdMinimumCents)} minimum`,
      })),
    ],
  });
  if (!kind) return;
  const isCd = kind.startsWith('CD:');
  const termMonths = isCd ? Number(kind.slice(3)) : undefined;
  const sources = accounts.filter(isDepositAccount);
  const key = newIdempotencyKey();

  const result = await ctx.ui.form({
    title: isCd ? `Open a ${termMonths}-Month CD` : 'Open a Savings Account',
    fields: [
      {
        name: 'nickname',
        label: 'Nickname (optional)',
        type: 'text',
        maxLength: 40,
        hint: 'Something like "Vacation" or "Rainy day".',
      },
      {
        name: 'fundingAccountId',
        label: 'Opening deposit from',
        type: 'select',
        options: accountOptions(sources),
      },
      {
        name: 'amount',
        label: isCd ? 'Opening deposit' : 'Opening deposit (optional)',
        type: 'money',
        hint: isCd
          ? `At least ${formatCents(LIMITS.cdMinimumCents)}.`
          : 'Leave blank to start at $0.00.',
      },
    ],
    ...(isCd
      ? {
          footnote: "A CD's money stays put until it matures. In exchange, it earns a higher rate.",
        }
      : {}),
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      if (isCd || values.amount?.trim()) readAmount(values, 'amount', errors);
      return errors;
    },
    submit: async (values) => {
      const amountCents = values.amount?.trim() ? readAmount(values, 'amount', emptyErrors())! : 0;
      const from = sources.find((a) => a.id === values.fundingAccountId);
      const sure = await ctx.ui.confirm({
        title: 'Confirm New Account',
        text: [
          `Open ${isCd ? `a ${termMonths}-month CD` : 'a savings account'}${values.nickname ? ` called "${values.nickname}"` : ''}?`,
          amountCents
            ? `${formatCents(amountCents)} will move from ${from?.nickname}.`
            : 'It will start with $0.00.',
        ],
        confirmLabel: 'Yes, open it',
      });
      if (!sure) throw new FormCancelled();
      return ctx.api.openAccount(
        {
          type: isCd ? 'CD' : 'SAVINGS',
          ...(values.nickname?.trim() ? { nickname: values.nickname.trim() } : {}),
          ...(termMonths ? { termMonths } : {}),
          ...(amountCents
            ? { fundingAccountId: values.fundingAccountId!, openingDepositCents: amountCents }
            : {}),
        },
        key,
      );
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Account Opened',
    tone: 'success',
    lines: [
      `${result.nickname} ${result.maskedNumber} is open with ${formatCents(result.balanceCents)}, earning ${(result.interestRateBps / 100).toFixed(2)}% a year.`,
    ],
  });
}

async function renameFlow(ctx: BankContext, accounts: AccountSummary[]) {
  const account = await pickAccount(ctx, accounts, 'Rename Which Account?');
  if (!account) return;
  const result = await ctx.ui.form({
    title: 'Rename Account',
    fields: [
      {
        name: 'nickname',
        label: 'New nickname',
        type: 'text',
        maxLength: 40,
        value: account.nickname,
      },
    ],
    submitLabel: 'Save',
    validate: (values) => {
      const errors = emptyErrors();
      if (!values.nickname?.trim()) errors.fields.nickname = 'Enter a nickname';
      return errors;
    },
    submit: (values) => ctx.api.renameAccount(account.id, values.nickname!.trim()),
  });
  if (result)
    await ctx.ui.result({
      title: 'Renamed',
      tone: 'success',
      lines: [`It's now called ${result.nickname}.`],
    });
}
