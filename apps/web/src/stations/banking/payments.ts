import {
  FREQUENCIES,
  LIMITS,
  formatCents,
  payeeSchema,
  type AccountSummary,
  type Payee,
} from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import { errorsFromZod } from '../../ui/windows/formErrors';
import { movementCell } from '../../ui/windows/money';
import { FormCancelled } from '../../ui/windows/windows';
import type { StationDef } from '../stations';
import {
  accountOptions,
  attempt,
  emptyErrors,
  formatDate,
  isDepositAccount,
  loadAccounts,
  readAmount,
  serverNow,
  speakerOf,
  tomorrow,
  type BankContext,
} from './kit';

type Choice = 'transfer' | 'send' | 'bill' | 'payees' | 'scheduled' | 'bye';

const FREQUENCY_LABEL: Record<(typeof FREQUENCIES)[number], string> = {
  ONCE: 'Just once',
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
};

/** Hazel at Transfers & Payments. */
export async function paymentsDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<Choice>({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'transfer', label: 'Transfer between my accounts' },
        { value: 'send', label: 'Send money to someone' },
        { value: 'bill', label: 'Pay a bill' },
        { value: 'payees', label: 'Manage payees' },
        { value: 'scheduled', label: 'Scheduled payments' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'What else can I move for you?';
    const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
    if (!accounts) return;

    if (choice === 'transfer') await transferFlow(ctx, accounts);
    if (choice === 'send') await sendFlow(ctx, accounts);
    if (choice === 'bill') await billFlow(ctx, accounts);
    if (choice === 'payees') await managePayees(ctx);
    if (choice === 'scheduled') await scheduledFlow(ctx, accounts);
  }
}

async function transferFlow(ctx: BankContext, accounts: AccountSummary[]) {
  if (accounts.length < 2) {
    await ctx.ui.result({
      title: 'One Account',
      tone: 'info',
      lines: ['You need two accounts to transfer. The Teller can open a savings account for you.'],
    });
    return;
  }
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Transfer',
    fields: [
      { name: 'fromAccountId', label: 'From', type: 'select', options: accountOptions(accounts) },
      {
        name: 'toAccountId',
        label: 'To',
        type: 'select',
        options: accountOptions(accounts),
        value: accounts[1]!.id,
      },
      { name: 'amount', label: 'Amount', type: 'money' },
      { name: 'memo', label: 'Memo (optional)', type: 'text', maxLength: 140 },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'amount', errors);
      if (values.fromAccountId === values.toAccountId)
        errors.fields.toAccountId = 'Choose two different accounts';
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      const from = accounts.find((a) => a.id === values.fromAccountId)!;
      const to = accounts.find((a) => a.id === values.toAccountId)!;
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Transfer',
          text: [`Move ${formatCents(amountCents)} from ${from.nickname} to ${to.nickname}?`],
          confirmLabel: 'Yes, transfer it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.transfer(
        {
          fromAccountId: from.id,
          toAccountId: to.id,
          amountCents,
          ...(values.memo?.trim() ? { memo: values.memo.trim() } : {}),
        },
        key,
      );
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Transfer Complete',
    tone: 'success',
    lines: [
      `${result.from.nickname}: ${formatCents(result.from.balanceCents)}.`,
      `${result.to.nickname}: ${formatCents(result.to.balanceCents)}.`,
    ],
  });
}

async function sendFlow(ctx: BankContext, accounts: AccountSummary[]) {
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Send Money',
    intro: ['Send money to another Bank of Bramblewood customer using their email.'],
    fields: [
      { name: 'fromAccountId', label: 'From', type: 'select', options: accountOptions(accounts) },
      { name: 'toEmail', label: 'Their email', type: 'email', autocomplete: 'off' },
      {
        name: 'amount',
        label: 'Amount',
        type: 'money',
        hint: `Up to ${formatCents(LIMITS.p2pDailyCents)} a day.`,
      },
      { name: 'memo', label: "What's it for? (optional)", type: 'text', maxLength: 140 },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      if (!/^\S+@\S+\.\S+$/.test(values.toEmail ?? ''))
        errors.fields.toEmail = 'Enter their email address';
      readAmount(values, 'amount', errors);
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Payment',
          text: [
            `Send ${formatCents(amountCents)} to ${values.toEmail}?`,
            'Money sent to another person arrives right away and cannot be pulled back.',
          ],
          confirmLabel: 'Yes, send it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.sendToPerson(
        {
          fromAccountId: values.fromAccountId!,
          toEmail: values.toEmail!,
          amountCents,
          ...(values.memo?.trim() ? { memo: values.memo.trim() } : {}),
        },
        key,
      );
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Money Sent',
    tone: 'success',
    lines: [
      `Sent to ${result.recipientName}.`,
      `${result.from.nickname} now has ${formatCents(result.from.balanceCents)}.`,
    ],
  });
  void ctx.watcher.refresh();
}

async function addPayeeForm(ctx: BankContext): Promise<Payee | null> {
  return ctx.ui.form({
    title: 'Add a Payee',
    intro: ['Who do you pay? Utility companies, landlords, that sort of thing. Make one up!'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', maxLength: 60 },
      { name: 'accountRef', label: 'Your account number with them', type: 'text', maxLength: 30 },
    ],
    submitLabel: 'Save payee',
    validate: (values) => {
      const parsed = payeeSchema.safeParse(values);
      return parsed.success ? emptyErrors() : errorsFromZod(parsed.error);
    },
    submit: (values) => ctx.api.addPayee({ name: values.name!, accountRef: values.accountRef! }),
  });
}

async function billFlow(ctx: BankContext, accounts: AccountSummary[]) {
  let payees = await attempt(ctx, () => ctx.api.getPayees());
  if (!payees) return;
  if (payees.length === 0) {
    const add = await ctx.ui.confirm({
      title: 'No Payees Yet',
      text: ["You haven't saved anyone to pay. Add a payee now?"],
      confirmLabel: 'Add a payee',
      cancelLabel: 'Not now',
    });
    if (!add) return;
    const payee = await addPayeeForm(ctx);
    if (!payee) return;
    payees = [payee];
  }
  const key = newIdempotencyKey();
  const result = await ctx.ui.form({
    title: 'Pay a Bill',
    fields: [
      {
        name: 'payeeId',
        label: 'Pay',
        type: 'select',
        options: payees.map((p) => ({ value: p.id, label: `${p.name} ${p.maskedRef}` })),
      },
      { name: 'fromAccountId', label: 'From', type: 'select', options: accountOptions(accounts) },
      { name: 'amount', label: 'Amount', type: 'money' },
      { name: 'memo', label: 'Memo (optional)', type: 'text', maxLength: 140 },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'amount', errors);
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      const payee = payees.find((p) => p.id === values.payeeId)!;
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Payment',
          text: [`Pay ${formatCents(amountCents)} to ${payee.name}?`],
          confirmLabel: 'Yes, pay it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.payBill(
        {
          payeeId: payee.id,
          fromAccountId: values.fromAccountId!,
          amountCents,
          ...(values.memo?.trim() ? { memo: values.memo.trim() } : {}),
        },
        key,
      );
    },
  });
  if (!result) return;
  await ctx.ui.result({
    title: 'Bill Paid',
    tone: 'success',
    lines: [
      `Done! ${result.account.nickname} now has ${formatCents(result.account.balanceCents)}.`,
    ],
  });
  void ctx.watcher.refresh();
}

async function managePayees(ctx: BankContext) {
  for (;;) {
    const payees = await attempt(ctx, () => ctx.api.getPayees());
    if (!payees) return;
    const pick = await ctx.ui.table<'add' | 'remove' | 'done'>({
      title: 'Your Payees',
      caption: 'Saved payees',
      columns: [{ label: 'Payee' }, { label: 'Account' }],
      rows: payees.map((p) => [p.name, p.maskedRef]),
      empty: 'No payees saved yet.',
      choices: [
        { value: 'add', label: 'Add a payee' },
        ...(payees.length ? [{ value: 'remove' as const, label: 'Remove a payee' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick === 'add') await addPayeeForm(ctx);
    else if (pick === 'remove') {
      const id = await ctx.ui.options({
        title: 'Remove Which Payee?',
        choices: payees.map((p) => ({ value: p.id, label: p.name, hint: p.maskedRef })),
      });
      const payee = payees.find((p) => p.id === id);
      if (!payee) continue;
      const sure = await ctx.ui.confirm({
        title: 'Remove Payee',
        text: [`Remove ${payee.name}? Any payments scheduled to them will be cancelled too.`],
        confirmLabel: 'Yes, remove',
        danger: true,
      });
      if (sure) await attempt(ctx, () => ctx.api.removePayee(payee.id));
    } else return;
  }
}

async function scheduledFlow(ctx: BankContext, accounts: AccountSummary[]) {
  for (;;) {
    const scheduled = await attempt(ctx, () => ctx.api.getScheduled());
    if (!scheduled) return;
    const active = scheduled.filter((s) => s.active);
    const pick = await ctx.ui.table<'new' | 'cancel' | 'done'>({
      title: 'Scheduled Payments',
      caption: 'Your scheduled payments',
      columns: [
        { label: 'To' },
        { label: 'From' },
        { label: 'How often' },
        { label: 'Next' },
        { label: 'Amount', align: 'end' },
      ],
      rows: scheduled.map((s) => [
        s.to,
        s.from,
        FREQUENCY_LABEL[s.frequency],
        s.active
          ? formatDate(s.nextRunDate)
          : s.lastResult === 'POSTED'
            ? 'Done'
            : 'Did not go through',
        movementCell(-s.amountCents),
      ]),
      empty: 'Nothing scheduled yet.',
      note: 'Payments run automatically on their date.',
      choices: [
        { value: 'new', label: 'Schedule a payment' },
        ...(active.length ? [{ value: 'cancel' as const, label: 'Cancel one' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick === 'new') await newScheduledFlow(ctx, accounts);
    else if (pick === 'cancel') {
      const id = await ctx.ui.options({
        title: 'Cancel Which?',
        choices: active.map((s) => ({
          value: s.id,
          label: `${formatCents(s.amountCents)} to ${s.to}`,
          hint: `${FREQUENCY_LABEL[s.frequency]} · next ${formatDate(s.nextRunDate)}`,
        })),
      });
      if (!id) continue;
      if (
        await ctx.ui.confirm({
          title: 'Cancel Payment',
          text: ['Cancel this scheduled payment?'],
          confirmLabel: 'Yes, cancel it',
          cancelLabel: 'Keep it',
          danger: true,
        })
      ) {
        await attempt(ctx, () => ctx.api.cancelScheduled(id));
      }
    } else return;
  }
}

async function newScheduledFlow(ctx: BankContext, accounts: AccountSummary[]) {
  const payees = (await attempt(ctx, () => ctx.api.getPayees())) ?? [];
  const destinations = [
    ...payees.map((p) => ({ value: `payee:${p.id}`, label: `${p.name} ${p.maskedRef}` })),
    ...accounts.map((a) => ({
      value: `account:${a.id}`,
      label: `My ${a.nickname} ${a.maskedNumber}`,
    })),
  ];
  const result = await ctx.ui.form({
    title: 'Schedule a Payment',
    fields: [
      { name: 'fromAccountId', label: 'From', type: 'select', options: accountOptions(accounts) },
      { name: 'to', label: 'To', type: 'select', options: destinations },
      { name: 'amount', label: 'Amount', type: 'money' },
      {
        name: 'frequency',
        label: 'How often',
        type: 'select',
        options: FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] })),
        value: 'MONTHLY',
      },
      {
        name: 'startDate',
        label: 'First payment on',
        type: 'date',
        value: tomorrow(serverNow(ctx)),
      },
    ],
    submitLabel: 'Continue',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'amount', errors);
      if (!values.startDate) errors.fields.startDate = 'Choose a date';
      if (values.to === `account:${values.fromAccountId}`)
        errors.fields.to = 'Choose a different account';
      return errors;
    },
    submit: async (values) => {
      const amountCents = readAmount(values, 'amount', emptyErrors())!;
      const [kind, id] = values.to!.split(':') as ['payee' | 'account', string];
      const label = destinations.find((d) => d.value === values.to)?.label ?? '';
      const freq = FREQUENCY_LABEL[values.frequency as (typeof FREQUENCIES)[number]].toLowerCase();
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Schedule',
          text: [
            `Pay ${formatCents(amountCents)} to ${label}, ${freq}, starting ${formatDate(values.startDate!)}?`,
          ],
          confirmLabel: 'Yes, schedule it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.schedule({
        fromAccountId: values.fromAccountId!,
        ...(kind === 'payee' ? { payeeId: id } : { toAccountId: id }),
        amountCents,
        frequency: values.frequency as (typeof FREQUENCIES)[number],
        startDate: values.startDate!,
      });
    },
  });
  if (result)
    await ctx.ui.result({
      title: 'Scheduled',
      tone: 'success',
      lines: ["All set. We'll take care of it on the date you picked."],
    });
}
