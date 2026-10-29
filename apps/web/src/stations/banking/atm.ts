import { LIMITS, formatCents, type AccountSummary } from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import { balanceCell } from '../../ui/windows/money';
import { FormCancelled } from '../../ui/windows/windows';
import { logInForm } from '../handlers';
import { depositFlow } from './teller';
import {
  accountChoices,
  attempt,
  emptyErrors,
  isDepositAccount,
  loadAccounts,
  readAmount,
  type BankContext,
} from './kit';

const QUICK_AMOUNTS = [2_000, 6_000, 10_000, 20_000];

/** The outdoor ATM: check in on the machine, then cash, deposits, and balances. */
export async function useAtm(ctx: BankContext) {
  const atm = { speaker: 'ATM', role: 'Bank of Bramblewood' };
  if (!ctx.watcher.signedIn) {
    const go = await ctx.ui.dialogue<'login' | 'bye'>({
      ...atm,
      lines: ['WELCOME. Please check in to continue.'],
      choices: [
        { value: 'login', label: 'Check in' },
        { value: 'bye', label: 'Cancel' },
      ],
    });
    if (go !== 'login' || !(await logInForm(ctx))) return;
  }

  for (;;) {
    const choice = await ctx.ui.dialogue<'balance' | 'cash' | 'deposit' | 'done'>({
      ...atm,
      lines: ['Choose a transaction.'],
      choices: [
        { value: 'cash', label: 'Withdraw cash' },
        { value: 'deposit', label: 'Deposit' },
        { value: 'balance', label: 'Check balances' },
        { value: 'done', label: 'Done' },
      ],
    });
    if (!choice || choice === 'done') {
      await ctx.ui.dialogue({
        ...atm,
        lines: ['Thank you for banking with Bramblewood. Have a lovely day!'],
      });
      return;
    }
    const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
    if (!accounts) return;
    if (choice === 'balance') {
      await ctx.ui.detail({
        title: 'Balances',
        items: accounts.map((a) => ({
          label: `${a.nickname} ${a.maskedNumber}`,
          value: balanceCell(a.balanceCents),
        })),
      });
    }
    if (choice === 'deposit') await depositFlow(ctx, accounts, 'ATM');
    if (choice === 'cash') await atmCash(ctx, accounts);
  }
}

async function atmCash(ctx: BankContext, accounts: AccountSummary[]) {
  const accountId =
    accounts.length === 1
      ? accounts[0]!.id
      : await ctx.ui.options({ title: 'From Which Account?', choices: accountChoices(accounts) });
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;

  const pick = await ctx.ui.options({
    title: 'How Much?',
    text: [`$20 notes only. Up to ${formatCents(LIMITS.atmDailyCents)} a day.`],
    choices: [
      ...QUICK_AMOUNTS.map((c) => ({ value: String(c), label: formatCents(c) })),
      { value: 'other', label: 'Other amount' },
    ],
  });
  if (!pick) return;

  const key = newIdempotencyKey();
  const send = async (amountCents: number) => {
    if (
      !(await ctx.ui.confirm({
        title: 'Confirm',
        text: [`Withdraw ${formatCents(amountCents)} from ${account.nickname}?`],
        confirmLabel: 'Yes',
      }))
    )
      return null;
    return ctx.api.withdraw({ accountId: account.id, amountCents, channel: 'ATM' }, key);
  };

  let result;
  if (pick === 'other') {
    result = await ctx.ui.form({
      title: 'Other Amount',
      fields: [{ name: 'amount', label: 'Amount (in $20s)', type: 'money' }],
      submitLabel: 'Continue',
      validate: (values) => {
        const errors = emptyErrors();
        const cents = readAmount(values, 'amount', errors);
        if (cents !== null && cents % LIMITS.atmNoteCents !== 0)
          errors.fields.amount = 'Choose an amount in $20s';
        return errors;
      },
      submit: async (values) => {
        const r = await send(readAmount(values, 'amount', emptyErrors())!);
        if (!r) throw new FormCancelled();
        return r;
      },
    });
  } else {
    result = await attempt(ctx, () => send(Number(pick)));
  }
  if (!result) return;
  await ctx.ui.result({
    title: 'Please Take Your Cash',
    tone: 'success',
    lines: [
      `The ATM whirs and counts out your notes. ${result.account.nickname} now has ${formatCents(result.account.balanceCents)}.`,
    ],
  });
}
