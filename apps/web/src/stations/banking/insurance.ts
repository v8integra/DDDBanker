import {
  COVERAGE_LEVELS,
  formatCents,
  type InsuranceQuoteInput,
  type QuoteView,
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
  readAmount,
  serverNow,
  speakerOf,
  type BankContext,
} from './kit';

type Kind = InsuranceQuoteInput['type'];
const KIND_LABEL: Record<Kind, string> = {
  AUTO: 'Auto',
  HOME: 'Home',
  RENTERS: 'Renters',
  LIFE: 'Life',
};
const STATUS_LABEL = {
  ACTIVE: '✓ Active',
  PAST_DUE: '⚠ Past due',
  CANCELLED: 'Cancelled',
} as const;
const coverage: FieldDef = {
  name: 'coverage',
  label: 'Coverage level',
  type: 'select',
  options: COVERAGE_LEVELS.map((c) => ({
    value: c,
    label:
      c === 'BASIC'
        ? 'Basic (lowest price)'
        : c === 'STANDARD'
          ? 'Standard'
          : 'Premium (most protection)',
  })),
  value: 'STANDARD',
};

/** Sage at Insurance (Bramble Mutual is fictional, like everything here). */
export async function insuranceDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<'quote' | 'quotes' | 'policies' | 'bye'>({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'quote', label: 'Get a quote' },
        { value: 'quotes', label: 'My saved quotes' },
        { value: 'policies', label: 'My policies' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'Anything else I can cover?';
    if (choice === 'quote') await quoteFlow(ctx);
    if (choice === 'quotes') await savedQuotesFlow(ctx);
    if (choice === 'policies') await policiesFlow(ctx);
  }
}

function fieldsFor(kind: Kind, year: number): FieldDef[] {
  switch (kind) {
    case 'AUTO':
      return [
        {
          name: 'vehicleYear',
          label: 'Vehicle year',
          type: 'text',
          maxLength: 4,
          value: String(year - 3),
        },
        { name: 'vehicleValue', label: 'Vehicle value', type: 'money' },
        { name: 'driverAge', label: 'Your age', type: 'text', maxLength: 3 },
        coverage,
      ];
    case 'HOME':
      return [{ name: 'homeValue', label: 'Home value', type: 'money' }, coverage];
    case 'RENTERS':
      return [
        {
          name: 'contentsValue',
          label: 'Value of your belongings',
          type: 'money',
          hint: 'Furniture, electronics, clothes. A guess is fine.',
        },
        coverage,
      ];
    case 'LIFE':
      return [
        { name: 'age', label: 'Your age', type: 'text', maxLength: 3 },
        {
          name: 'amount',
          label: 'Benefit amount',
          type: 'money',
          hint: 'What your family would receive.',
        },
        {
          name: 'termYears',
          label: 'Term',
          type: 'select',
          options: [10, 20, 30].map((y) => ({ value: String(y), label: `${y} years` })),
          value: '20',
        },
      ];
  }
}

function toQuoteInput(kind: Kind, v: Record<string, string>): InsuranceQuoteInput {
  const money = (name: string) => readAmount(v, name, emptyErrors())!;
  const coverageLevel = v.coverage as (typeof COVERAGE_LEVELS)[number];
  switch (kind) {
    case 'AUTO':
      return {
        type: kind,
        vehicleYear: Number(v.vehicleYear),
        vehicleValueCents: money('vehicleValue'),
        driverAge: Number(v.driverAge),
        coverage: coverageLevel,
      };
    case 'HOME':
      return { type: kind, homeValueCents: money('homeValue'), coverage: coverageLevel };
    case 'RENTERS':
      return { type: kind, contentsValueCents: money('contentsValue'), coverage: coverageLevel };
    case 'LIFE':
      return {
        type: kind,
        age: Number(v.age),
        coverageCents: money('amount'),
        termYears: Number(v.termYears) as 10 | 20 | 30,
      };
  }
}

async function quoteFlow(ctx: BankContext) {
  const kind = await ctx.ui.options<Kind>({
    title: 'What Should We Cover?',
    choices: [
      { value: 'AUTO', label: 'Auto', hint: 'Your car' },
      { value: 'HOME', label: 'Home', hint: 'A house you own' },
      { value: 'RENTERS', label: 'Renters', hint: 'Your belongings where you rent' },
      { value: 'LIFE', label: 'Life', hint: 'Term life insurance' },
    ],
  });
  if (!kind) return;
  const year = new Date(serverNow(ctx)).getUTCFullYear();
  const quote = await ctx.ui.form({
    title: `${KIND_LABEL[kind]} Quote`,
    fields: fieldsFor(kind, year),
    submitLabel: 'Get my quote',
    validate: (v) => {
      const errors = emptyErrors();
      for (const f of fieldsFor(kind, year)) if (f.type === 'money') readAmount(v, f.name, errors);
      const ageField = kind === 'AUTO' ? 'driverAge' : kind === 'LIFE' ? 'age' : null;
      if (ageField && !/^\d{2,3}$/.test(v[ageField] ?? ''))
        errors.fields[ageField] = 'Enter your age in years';
      if (kind === 'AUTO' && !/^\d{4}$/.test(v.vehicleYear ?? ''))
        errors.fields.vehicleYear = 'Enter a 4-digit year';
      return errors;
    },
    submit: (v) => ctx.api.quote(toQuoteInput(kind, v)),
  });
  if (quote) await showQuote(ctx, quote);
}

async function showQuote(ctx: BankContext, quote: QuoteView) {
  const pick = await ctx.ui.table<'bind' | 'later'>({
    title: `${KIND_LABEL[quote.type]} Quote`,
    caption: 'Your quote',
    columns: [{ label: 'Detail' }, { label: 'Quote', align: 'end' }],
    rows: [
      ['Cover', quote.summary],
      ['Coverage', balanceCell(quote.coverageCents)],
      ['Monthly premium', balanceCell(quote.monthlyPremiumCents)],
    ],
    note: `Good until ${formatDate(quote.expiresAt)}. Bramble Mutual is a pretend insurer: nothing here is real cover.`,
    choices: [
      { value: 'bind', label: 'Start this policy' },
      { value: 'later', label: 'Save it for later' },
    ],
  });
  if (pick === 'bind') await bindFlow(ctx, quote);
}

async function bindFlow(ctx: BankContext, quote: QuoteView) {
  const accounts = (await loadAccounts(ctx))?.filter(isDepositAccount);
  if (!accounts) return;
  const key = newIdempotencyKey();
  const policy = await ctx.ui.form({
    title: 'Start Policy',
    fields: [
      {
        name: 'from',
        label: 'Pay premiums from',
        type: 'select',
        options: accountOptions(accounts),
      },
    ],
    footnote: 'The first month is paid today, then the same day each month.',
    submitLabel: 'Continue',
    submit: async (v) => {
      if (
        !(await ctx.ui.confirm({
          title: 'Confirm',
          text: [
            `Start ${KIND_LABEL[quote.type].toLowerCase()} cover for ${formatCents(quote.monthlyPremiumCents)} a month?`,
          ],
          confirmLabel: 'Yes, start it',
        }))
      ) {
        throw new FormCancelled();
      }
      return ctx.api.bindQuote(quote.id, v.from!, key);
    },
  });
  if (!policy) return;
  await ctx.ui.result({
    title: 'You Are Covered',
    tone: 'success',
    lines: [
      `Policy ${policy.number} is active. ${formatCents(policy.monthlyPremiumCents)} a month from ${policy.payFrom}.`,
    ],
  });
  void ctx.watcher.refresh();
}

async function savedQuotesFlow(ctx: BankContext) {
  const quotes = await attempt(ctx, () => ctx.api.getQuotes());
  if (!quotes) return;
  if (quotes.length === 0) {
    await ctx.ui.result({
      title: 'No Saved Quotes',
      tone: 'info',
      lines: ['Quotes are kept for 30 days. Ask Sage for a new one anytime.'],
    });
    return;
  }
  const id = await ctx.ui.options({
    title: 'Saved Quotes',
    choices: quotes.map((q) => ({
      value: q.id,
      label: `${KIND_LABEL[q.type]}: ${formatCents(q.monthlyPremiumCents)}/month`,
      hint: q.summary,
    })),
  });
  const quote = quotes.find((q) => q.id === id);
  if (quote) await showQuote(ctx, quote);
}

async function policiesFlow(ctx: BankContext) {
  for (;;) {
    const policies = await attempt(ctx, () => ctx.api.getPolicies());
    if (!policies) return;
    const live = policies.filter((p) => p.status !== 'CANCELLED');
    const pick = await ctx.ui.table<'cancel' | 'done'>({
      title: 'Your Policies',
      caption: 'Your insurance policies',
      columns: [
        { label: 'Policy' },
        { label: 'Type' },
        { label: 'Status' },
        { label: 'Next premium' },
        { label: 'Monthly', align: 'end' },
      ],
      rows: policies.map((p) => [
        p.number,
        KIND_LABEL[p.type],
        STATUS_LABEL[p.status],
        p.status === 'CANCELLED' ? '—' : formatDate(p.nextPremiumDate),
        balanceCell(p.monthlyPremiumCents),
      ]),
      empty: 'No policies yet.',
      choices: [
        ...(live.length ? [{ value: 'cancel' as const, label: 'Cancel a policy' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick !== 'cancel') return;
    const id = await ctx.ui.options({
      title: 'Cancel Which?',
      choices: live.map((p) => ({ value: p.id, label: p.number, hint: KIND_LABEL[p.type] })),
    });
    if (!id) continue;
    if (
      await ctx.ui.confirm({
        title: 'Cancel Policy',
        text: ['Cancel this policy? Cover ends today and no more premiums are taken.'],
        confirmLabel: 'Yes, cancel it',
        cancelLabel: 'Keep it',
        danger: true,
      })
    ) {
      await attempt(ctx, () => ctx.api.cancelPolicy(id));
    }
  }
}
