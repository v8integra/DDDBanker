import {
  LENDING,
  dollarInputSchema,
  formatCents,
  type LoanApplicationInput,
  type LoanApplicationView,
  type LoanProduct,
  type LoanView,
} from '@dddbanker/shared';
import { newIdempotencyKey } from '../../api/client';
import { balanceCell } from '../../ui/windows/money';
import { FormCancelled, type FieldDef } from '../../ui/windows/windows';
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
  serverNow,
  speakerOf,
  type BankContext,
} from './kit';

const NOUN: Record<LoanProduct, string> = {
  AUTO: 'auto loan',
  MORTGAGE: 'home loan',
  PERSONAL: 'personal loan',
};
const termLabel = (months: number) =>
  months % 12 === 0 ? `${months / 12} years (${months} months)` : `${months} months`;

const incomeFields: FieldDef[] = [
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
    hint: 'Car payments, student loans, cards elsewhere. Not rent. 0 is fine.',
    value: '0',
  },
];

/** Ash (auto), Maple (home), and Fennel (personal) all work the same way. */
export async function lendingDesk(def: StationDef, ctx: BankContext, product: LoanProduct) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<'calc' | 'apply' | 'offers' | 'mine' | 'bye'>({
      ...staff,
      lines: [greeting],
      choices: [
        ...(product === 'PERSONAL'
          ? []
          : [{ value: 'calc' as const, label: 'Payment calculator' }]),
        { value: 'apply', label: `Apply for a ${NOUN[product]}` },
        { value: 'offers', label: 'My offers' },
        { value: 'mine', label: `My ${NOUN[product]}s` },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'What else can I help with?';
    if (choice === 'calc') await calculatorFlow(ctx, product as 'AUTO' | 'MORTGAGE');
    if (choice === 'apply') await applyFlow(ctx, product);
    if (choice === 'offers') await offersFlow(ctx, product);
    if (choice === 'mine') await myLoansFlow(ctx, product);
  }
}

async function calculatorFlow(ctx: BankContext, product: 'AUTO' | 'MORTGAGE') {
  const terms = LENDING[product].terms;
  const result = await ctx.ui.form({
    title: `${product === 'AUTO' ? 'Car' : 'Home'} Payment Calculator`,
    intro: [
      `Uses our standard rate of ${percent(LENDING[product].baseRateBps)}. Your actual rate depends on your credit.`,
    ],
    fields: [
      { name: 'price', label: product === 'AUTO' ? 'Vehicle price' : 'Home price', type: 'money' },
      { name: 'down', label: 'Down payment', type: 'money', value: '0' },
      {
        name: 'term',
        label: 'Term',
        type: 'select',
        options: terms.map((t) => ({ value: String(t), label: termLabel(t) })),
        value: String(terms.at(-1)),
      },
    ],
    submitLabel: 'Calculate',
    validate: (values) => {
      const errors = emptyErrors();
      readAmount(values, 'price', errors);
      if (values.down?.trim() && values.down.trim() !== '0') readAmount(values, 'down', errors);
      return errors;
    },
    submit: (values) =>
      ctx.api.calculate(product === 'AUTO' ? 'auto' : 'mortgage', {
        priceCents: readAmount(values, 'price', emptyErrors())!,
        downPaymentCents: optionalAmount(values.down),
        termMonths: Number(values.term),
      }),
  });
  if (!result) return;
  await ctx.ui.detail({
    title: 'Estimated Payment',
    items: [
      { label: 'Loan amount', value: balanceCell(result.loanAmountCents) },
      { label: 'Rate', value: percent(result.rateBps) },
      { label: 'Term', value: termLabel(result.termMonths) },
      { label: 'Monthly payment', value: balanceCell(result.monthlyPaymentCents) },
      { label: 'Total interest', value: balanceCell(result.totalInterestCents) },
    ],
  });
}

function optionalAmount(value: string | undefined) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '0') return 0;
  const parsed = dollarInputSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : 0;
}

function applicationFields(product: LoanProduct, year: number): FieldDef[] {
  const terms = LENDING[product].terms.map((t) => ({ value: String(t), label: termLabel(t) }));
  const term: FieldDef = {
    name: 'term',
    label: 'Term',
    type: 'select',
    options: terms,
    value: terms.at(product === 'MORTGAGE' ? -1 : 2)!.value,
  };
  if (product === 'AUTO') {
    return [
      { name: 'price', label: 'Vehicle price', type: 'money' },
      { name: 'down', label: 'Down payment', type: 'money', value: '0' },
      { name: 'year', label: 'Vehicle year', type: 'text', value: String(year), maxLength: 4 },
      term,
      ...incomeFields,
    ];
  }
  if (product === 'MORTGAGE') {
    return [
      { name: 'price', label: 'Home price', type: 'money' },
      {
        name: 'down',
        label: 'Down payment',
        type: 'money',
        hint: `At least ${LENDING.MORTGAGE.minDownPercent}% of the price.`,
      },
      term,
      ...incomeFields,
    ];
  }
  return [
    {
      name: 'amount',
      label: 'How much do you need?',
      type: 'money',
      hint: `${formatCents(LENDING.PERSONAL.minCents)} to ${formatCents(LENDING.PERSONAL.maxCents)}.`,
    },
    { name: 'purpose', label: "What's it for?", type: 'text', maxLength: 60 },
    term,
    ...incomeFields,
  ];
}

function toApplication(product: LoanProduct, values: Record<string, string>): LoanApplicationInput {
  const base = {
    annualIncomeCents: readAmount(values, 'income', emptyErrors()) ?? 0,
    monthlyDebtCents: optionalAmount(values.debts),
    termMonths: Number(values.term),
  };
  if (product === 'AUTO') {
    return {
      product,
      priceCents: readAmount(values, 'price', emptyErrors())!,
      downPaymentCents: optionalAmount(values.down),
      vehicleYear: Number(values.year),
      ...base,
    };
  }
  if (product === 'MORTGAGE') {
    return {
      product,
      priceCents: readAmount(values, 'price', emptyErrors())!,
      downPaymentCents: optionalAmount(values.down),
      ...base,
    };
  }
  return {
    product,
    amountCents: readAmount(values, 'amount', emptyErrors())!,
    purpose: values.purpose!.trim(),
    ...base,
  };
}

async function applyFlow(ctx: BankContext, product: LoanProduct) {
  const year = new Date(serverNow(ctx)).getUTCFullYear();
  const app = await ctx.ui.form({
    title: `Apply: ${NOUN[product][0]!.toUpperCase()}${NOUN[product].slice(1)}`,
    intro: ['You get an answer right away. Applying never affects your (pretend) credit score.'],
    fields: applicationFields(product, year),
    submitLabel: 'Apply',
    validate: (values) => {
      const errors = emptyErrors();
      if (product === 'PERSONAL') {
        readAmount(values, 'amount', errors);
        if ((values.purpose ?? '').trim().length < 2)
          errors.fields.purpose = "Tell us what it's for";
      } else {
        readAmount(values, 'price', errors);
        if (product === 'MORTGAGE') readAmount(values, 'down', errors);
      }
      if (product === 'AUTO' && !/^\d{4}$/.test(values.year ?? ''))
        errors.fields.year = 'Enter a 4-digit year';
      readAmount(values, 'income', errors);
      return errors;
    },
    submit: (values) => ctx.api.apply(toApplication(product, values)),
  });
  if (app) await showDecision(ctx, app);
}

/** Show a decision; offer to accept right away. */
async function showDecision(ctx: BankContext, app: LoanApplicationView) {
  if (app.decision === 'DECLINED' || !app.offer) {
    await ctx.ui.result({
      title: 'Not This Time',
      tone: 'error',
      lines: [
        app.reason ?? 'We could not approve this application.',
        'You can try different numbers anytime.',
      ],
    });
    return;
  }
  const o = app.offer;
  const isCard = app.product === 'CREDIT_CARD';
  const pick = await ctx.ui.table<'accept' | 'later'>({
    title: app.decision === 'APPROVED' ? 'Approved!' : 'Here Is What We Can Do',
    caption: 'Your offer',
    columns: [{ label: 'Detail' }, { label: 'Offer', align: 'end' }],
    rows: isCard
      ? [
          ['Credit limit', balanceCell(o.creditLimitCents ?? o.amountCents)],
          ['APR', percent(o.rateBps)],
        ]
      : [
          ['Amount', balanceCell(o.amountCents)],
          ['Rate', percent(o.rateBps)],
          ['Term', termLabel(o.termMonths)],
          ['Monthly payment', balanceCell(o.monthlyPaymentCents)],
        ],
    note: `${app.reason ? `${app.reason} ` : ''}This offer is good until ${formatDate(app.expiresAt)}.`,
    choices: [
      { value: 'accept', label: 'Accept this offer' },
      { value: 'later', label: 'Not now (keep it for later)' },
    ],
  });
  if (pick === 'accept') await acceptFlow(ctx, app);
}

async function acceptFlow(ctx: BankContext, app: LoanApplicationView) {
  const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
  if (!accounts || !app.offer) return;
  const key = newIdempotencyKey();
  const isCard = app.product === 'CREDIT_CARD';
  // Car and home loans: whatever the loan doesn't cover is the down payment
  // (a counter-offer for less money means a bigger down payment).
  const down = app.priceCents ? Math.max(0, app.priceCents - app.offer.amountCents) : 0;

  const fields: FieldDef[] = isCard
    ? []
    : [
        ...(down > 0
          ? [
              {
                name: 'downFrom',
                label: `Down payment of ${formatCents(down)} from`,
                type: 'select',
                options: accountOptions(accounts),
              } as FieldDef,
            ]
          : []),
        {
          name: 'autopay',
          label: 'Autopay',
          type: 'select',
          options: [
            { value: '', label: 'No thanks, I will pay myself' },
            ...accountOptions(accounts).map((o) => ({ ...o, label: `From ${o.label}` })),
          ],
        },
      ];

  const run = async (values: Record<string, string>) => {
    const lines = isCard
      ? [
          `Open a Bramble credit card with a ${formatCents(app.offer!.creditLimitCents ?? 0)} limit at ${percent(app.offer!.rateBps)} APR?`,
        ]
      : [
          `Borrow ${formatCents(app.offer!.amountCents)} at ${percent(app.offer!.rateBps)} for ${termLabel(app.offer!.termMonths)}?`,
          `${formatCents(app.offer!.monthlyPaymentCents)} a month, first payment in one month.`,
          ...(down > 0 ? [`${formatCents(down)} down payment comes out today.`] : []),
        ];
    if (!(await ctx.ui.confirm({ title: 'Confirm', text: lines, confirmLabel: 'Yes, accept' })))
      throw new FormCancelled();
    return ctx.api.acceptOffer(
      app.id,
      {
        ...(values.autopay ? { autopayFromAccountId: values.autopay } : {}),
        ...(values.downFrom ? { downPaymentFromAccountId: values.downFrom } : {}),
      },
      key,
    );
  };

  const result = fields.length
    ? await ctx.ui.form({ title: 'Accept Offer', fields, submitLabel: 'Continue', submit: run })
    : await attempt(ctx, () =>
        run({}).catch((err: unknown) =>
          err instanceof FormCancelled ? null : Promise.reject(err),
        ),
      );
  if (!result) return;
  await ctx.ui.result({
    title: isCard ? 'Card Opened' : 'Loan Opened',
    tone: 'success',
    lines: isCard
      ? ['Your Bramble credit card is ready. Find it at the Cards desk, or in your balances.']
      : app.product === 'PERSONAL'
        ? ['The money is in your checking account. Your first payment is due in a month.']
        : ['The money went straight to the seller. Your first payment is due in a month.'],
  });
  void ctx.watcher.refresh();
}

async function offersFlow(ctx: BankContext, product: LoanProduct | 'CREDIT_CARD') {
  const apps = await attempt(ctx, () => ctx.api.getApplications());
  if (!apps) return;
  const open = apps.filter((a) => a.product === product && a.status === 'OFFER');
  if (open.length === 0) {
    await ctx.ui.result({
      title: 'No Offers',
      tone: 'info',
      lines: ['You have no open offers for this right now.'],
    });
    return;
  }
  const id = await ctx.ui.options({
    title: 'Your Offers',
    choices: open.map((a) => ({
      value: a.id,
      label: a.offer?.creditLimitCents
        ? `${formatCents(a.offer.creditLimitCents)} limit`
        : `${formatCents(a.offer!.amountCents)} over ${termLabel(a.offer!.termMonths)}`,
      hint: `${percent(a.offer!.rateBps)} · good until ${formatDate(a.expiresAt)}`,
    })),
  });
  const app = open.find((a) => a.id === id);
  if (app) await showDecision(ctx, app);
}

async function myLoansFlow(ctx: BankContext, product: LoanProduct) {
  const loans = (await attempt(ctx, () => ctx.api.getLoans()))?.filter(
    (l) => l.product === product,
  );
  if (!loans) return;
  if (loans.length === 0) {
    await ctx.ui.result({
      title: 'No Loans',
      tone: 'info',
      lines: [`You don't have a ${NOUN[product]} with us yet.`],
    });
    return;
  }
  const id =
    loans.length === 1
      ? loans[0]!.accountId
      : await ctx.ui.options({
          title: 'Which Loan?',
          choices: loans.map((l) => ({
            value: l.accountId,
            label: `${l.nickname} ${l.maskedNumber}`,
            hint: `${formatCents(l.balanceOwedCents)} owed`,
          })),
        });
  let loan = loans.find((l) => l.accountId === id);
  while (loan) {
    const paidOff = loan.status === 'PAID_OFF';
    const pick = await ctx.ui.table<'pay' | 'schedule' | 'done'>({
      title: `${loan.nickname} ${loan.maskedNumber}`,
      caption: 'Loan details',
      columns: [{ label: 'Detail' }, { label: 'Value', align: 'end' }],
      rows: [
        ['Still owed', balanceCell(loan.balanceOwedCents)],
        ['Due now', balanceCell(loan.amountDueCents)],
        ['Monthly payment', balanceCell(loan.monthlyPaymentCents)],
        ['Next bill', paidOff ? 'Paid off 🎉' : formatDate(loan.nextDueDate)],
        ['Rate', percent(loan.rateBps)],
        ['Payments billed', `${loan.installmentsBilled} of ${loan.termMonths}`],
        ['Autopay', loan.autopayFrom ? `From ${loan.autopayFrom}` : 'Off'],
      ],
      choices: paidOff
        ? [{ value: 'done', label: 'Done' }]
        : [
            { value: 'pay', label: 'Make a payment' },
            { value: 'schedule', label: 'Payment schedule' },
            { value: 'done', label: 'Done' },
          ],
    });
    if (pick === 'schedule') await scheduleFlow(ctx, loan);
    else if (pick === 'pay') loan = (await payLoanFlow(ctx, loan)) ?? loan;
    else return;
  }
}

async function scheduleFlow(ctx: BankContext, loan: LoanView) {
  const rows = await attempt(ctx, () => ctx.api.getSchedule(loan.accountId));
  if (!rows) return;
  await ctx.ui.table({
    title: 'Payment Schedule',
    caption: `Upcoming payments for ${loan.nickname}`,
    columns: [
      { label: 'Due' },
      { label: 'Payment', align: 'end' },
      { label: 'Interest', align: 'end' },
      { label: 'Principal', align: 'end' },
      { label: 'Balance after', align: 'end' },
    ],
    rows: rows
      .slice(0, 12)
      .map((r) => [
        formatDate(r.dueDate),
        balanceCell(r.paymentCents),
        balanceCell(r.interestCents),
        balanceCell(r.principalCents),
        balanceCell(r.balanceCents),
      ]),
    ...(rows.length > 12
      ? { note: `Showing the next 12 of ${rows.length} payments. Paying extra shortens the list.` }
      : {}),
  });
}

export async function payLoanFlow(ctx: BankContext, loan: LoanView): Promise<LoanView | null> {
  const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
  if (!accounts) return null;
  const key = newIdempotencyKey();
  const suggested = loan.amountDueCents || loan.monthlyPaymentCents;
  const result = await ctx.ui.form({
    title: 'Loan Payment',
    fields: [
      { name: 'from', label: 'Pay from', type: 'select', options: accountOptions(accounts) },
      {
        name: 'amount',
        label: 'Amount',
        type: 'money',
        value: (Math.min(suggested, loan.balanceOwedCents) / 100).toFixed(2),
        hint: `Due now: ${formatCents(loan.amountDueCents)}. Paid off at ${formatCents(loan.balanceOwedCents)}. Anything extra goes to principal.`,
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
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm Payment',
          text: [`Pay ${formatCents(amountCents)} toward ${loan.nickname}?`],
          confirmLabel: 'Yes, pay it',
        }))
      )
        throw new FormCancelled();
      return ctx.api.payLoan(loan.accountId, values.from!, amountCents, key);
    },
  });
  if (result) {
    await ctx.ui.result({
      title: result.status === 'PAID_OFF' ? 'Paid Off!' : 'Payment Received',
      tone: 'success',
      lines: [
        result.status === 'PAID_OFF'
          ? `🎉 ${result.nickname} is paid off. Congratulations!`
          : `You now owe ${formatCents(result.balanceOwedCents)}.`,
      ],
    });
  }
  return result;
}

export { acceptFlow, offersFlow, showDecision };
