import {
  BANK,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  signupSchema,
  type AccountSummary,
} from '@dddbanker/shared';
import { ApiRequestError } from '../api/client';
import { NO_ERRORS, errorsFromZod, type FormErrors } from '../ui/windows/formErrors';
import { balanceCell } from '../ui/windows/money';
import { cardsDesk } from './banking/cards';
import { helpDesk, notificationsWindow } from './banking/help';
import { speakerOf, type BankContext } from './banking/kit';
import { paymentsDesk } from './banking/payments';
import { securityDesk } from './banking/security';
import { openAccountFlow, showBalances, tellerDesk } from './banking/teller';
import type { StationDef } from './stations';

export type StationContext = BankContext;

const soon = 'This window opens in an upcoming update of the bank.';

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CD: 'CD',
  CREDIT_CARD: 'Credit card',
  AUTO_LOAN: 'Auto loan',
  MORTGAGE: 'Mortgage',
  PERSONAL_LOAN: 'Personal loan',
};

/** What happens when you talk to each station. The lending and insurance desks arrive in Phase 6. */
export async function runStation(def: StationDef, ctx: StationContext) {
  switch (def.id) {
    case 'checkin':
      return checkInDesk(def, ctx);
    case 'newAccounts':
      return newAccountsDesk(def, ctx);
    case 'exit':
      return checkOutDesk(def, ctx);
    case 'teller':
      return tellerDesk(def, ctx);
    case 'transfers':
      return paymentsDesk(def, ctx);
    case 'cards':
      return cardsDesk(def, ctx);
    case 'security':
      return securityDesk(def, ctx);
    case 'help':
      return helpDesk(def, ctx);
    case 'savings':
      return savingsDesk(def, ctx);
    case 'notifications':
      return notificationsWindow(ctx);
    default: {
      const staff = speakerOf(def);
      await ctx.ui.dialogue({
        ...staff,
        lines: [def.greeting, `Here you'll be able to: ${def.services.join(' · ')}.`, soon],
      });
    }
  }
}

function signedInName(ctx: StationContext) {
  const session = ctx.watcher.session;
  return session?.authenticated ? session.user.name : null;
}

// ---------- Check-In: log in, forgot password ----------

async function checkInDesk(def: StationDef, ctx: StationContext) {
  const staff = speakerOf(def);
  const name = signedInName(ctx);

  if (name) {
    const choice = await ctx.ui.dialogue<'checkout' | 'bye'>({
      ...staff,
      lines: [`Welcome back, ${name}! You're checked in, so the security gate is open for you.`],
      choices: [
        { value: 'bye', label: 'Thanks!' },
        { value: 'checkout', label: 'Check me out' },
      ],
    });
    if (choice === 'checkout') await confirmCheckOut(staff, ctx);
    return;
  }

  for (;;) {
    const choice = await ctx.ui.dialogue<'login' | 'forgot' | 'bye'>({
      ...staff,
      lines: [def.greeting],
      choices: [
        { value: 'login', label: 'Check in' },
        { value: 'forgot', label: 'I forgot my password' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (choice === 'login') {
      if (await logInForm(ctx)) {
        const who = signedInName(ctx) ?? 'friend';
        await ctx.ui.dialogue({
          ...staff,
          lines: [
            `You're all checked in, ${who}! The security gate is open. Head on through to the banking hall.`,
          ],
        });
        return;
      }
      continue; // backed out of the form: offer the menu again
    }
    if (choice === 'forgot') {
      await ctx.ui.dialogue({
        ...staff,
        lines: [
          "Oh no! At a real bank, I'd email you a secure link to reset it.",
          `This is a demo bank, so it can't send email. If you're using one of the demo accounts, its password is in the project's README. Otherwise, New Accounts can set you up with a fresh one.`,
        ],
      });
      continue;
    }
    return;
  }
}

/** Returns true once signed in. */
/**
 * The check-in form (shared with the ATM). If two-step verification is on,
 * a second window asks for the code. Returns true once signed in.
 */
export async function logInForm(ctx: StationContext) {
  let pending: { email: string; password: string } | null = null;
  const result = await ctx.ui.form<boolean | 'needs-code'>({
    title: 'Check In',
    notice: BANK.disclaimer,
    fields: [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'username' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
    ],
    submitLabel: 'Check in',
    validate: (values) => {
      const parsed = loginSchema.safeParse(values);
      if (parsed.success) return NO_ERRORS;
      const errors = errorsFromZod(parsed.error);
      if (errors.fields.password) errors.fields.password = 'Enter your password';
      return errors;
    },
    submit: async (values) => {
      const credentials = { email: values.email!, password: values.password! };
      try {
        const session = await ctx.api.login(credentials);
        ctx.watcher.apply(session);
        return session.authenticated;
      } catch (err) {
        if (err instanceof ApiRequestError && err.body?.error === 'TWO_FACTOR_REQUIRED') {
          pending = credentials;
          return 'needs-code';
        }
        throw err;
      }
    },
  });
  if (result !== 'needs-code' || !pending) return result === true;
  return twoFactorForm(ctx, pending);
}

async function twoFactorForm(
  ctx: StationContext,
  credentials: { email: string; password: string },
) {
  const result = await ctx.ui.form({
    title: 'Two-Step Verification',
    intro: ['Open your authenticator app and enter the 6-digit code for the Bank of Bramblewood.'],
    fields: [
      { name: 'totpCode', label: '6-digit code', type: 'code', autocomplete: 'one-time-code' },
    ],
    submitLabel: 'Check in',
    validate: (values) => {
      const errors = { fields: {} as Record<string, string>, form: null };
      if (!/^\d{6}$/.test((values.totpCode ?? '').trim()))
        errors.fields.totpCode = 'Enter the 6-digit code';
      return errors;
    },
    submit: async (values) => {
      const session = await ctx.api.login({ ...credentials, totpCode: values.totpCode!.trim() });
      ctx.watcher.apply(session);
      return session.authenticated;
    },
  });
  return result === true;
}

// ---------- Savings & Investments ----------

async function savingsDesk(def: StationDef, ctx: StationContext) {
  const staff = speakerOf(def);
  for (;;) {
    const choice = await ctx.ui.dialogue<'open' | 'mine' | 'bye'>({
      ...staff,
      lines: [def.greeting],
      choices: [
        { value: 'open', label: 'Open a savings account or CD' },
        { value: 'mine', label: 'My savings and CDs' },
        { value: 'bye', label: 'Just looking!' },
      ],
    });
    if (!choice || choice === 'bye') return;
    const accounts = await ctx.api.getAccounts().catch(() => null);
    if (!accounts) return;
    if (choice === 'open') await openAccountFlow(ctx, accounts);
    if (choice === 'mine')
      await showBalances(
        ctx,
        accounts.filter((a) => a.type === 'SAVINGS' || a.type === 'CD'),
      );
  }
}

// ---------- New Accounts: sign up ----------

async function newAccountsDesk(def: StationDef, ctx: StationContext) {
  const staff = speakerOf(def);
  const name = signedInName(ctx);
  if (name) {
    await ctx.ui.dialogue({
      ...staff,
      lines: [
        `You already bank with us, ${name}. Head through the gate to the hall! More account types are coming to the Teller soon.`,
      ],
    });
    return;
  }

  for (;;) {
    const choice = await ctx.ui.dialogue<'open' | 'what' | 'bye'>({
      ...staff,
      lines: [def.greeting],
      choices: [
        { value: 'open', label: 'Open my accounts' },
        { value: 'what', label: 'What do I get?' },
        { value: 'bye', label: 'Never mind' },
      ],
    });
    if (choice === 'what') {
      await ctx.ui.dialogue({
        ...staff,
        lines: [
          'You get an Everyday Checking account and a Bramble Savings account earning 3.50% a year.',
          "As a welcome gift, we'll put $1,000.00 of play money in your checking. None of it is real, so have fun!",
        ],
      });
      continue;
    }
    if (choice !== 'open') return;

    const signedUp = await signUpForm(ctx);
    if (!signedUp) continue;

    await showNewAccounts(ctx);
    await ctx.ui.dialogue({
      ...staff,
      lines: [
        `Welcome to the Bank of Bramblewood, ${signedInName(ctx) ?? 'friend'}! You're checked in, and the security gate is open for you.`,
      ],
    });
    return;
  }
}

export function validateSignup(values: Record<string, string>): FormErrors {
  const parsed = signupSchema.safeParse(values);
  const errors = parsed.success ? { fields: {}, form: null } : errorsFromZod(parsed.error);
  if (!errors.fields.password && values.password !== values.confirm) {
    errors.fields.confirm = 'The two passwords do not match';
  }
  return errors;
}

async function signUpForm(ctx: StationContext) {
  const result = await ctx.ui.form({
    title: 'Open Your Accounts',
    intro: ['Checking, savings, and a $1,000.00 welcome bonus, in about a minute.'],
    notice: BANK.disclaimer,
    fields: [
      { name: 'name', label: 'Your name', type: 'text', autocomplete: 'name', maxLength: 80 },
      {
        name: 'email',
        label: 'Email',
        type: 'email',
        autocomplete: 'email',
        hint: 'Make one up! A .test address is perfect.',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        autocomplete: 'new-password',
        hint: `At least ${PASSWORD_MIN_LENGTH} characters, with a mix of different ones. A short sentence works well.`,
      },
      {
        name: 'confirm',
        label: 'Type the password again',
        type: 'password',
        autocomplete: 'new-password',
      },
    ],
    submitLabel: 'Open my accounts',
    validate: validateSignup,
    submit: async (values) => {
      const session = await ctx.api.signup({
        name: values.name!,
        email: values.email!,
        password: values.password!,
      });
      ctx.watcher.apply(session);
      return session.authenticated;
    },
  });
  return result === true;
}

async function showNewAccounts(ctx: StationContext) {
  let accounts: AccountSummary[];
  try {
    accounts = await ctx.api.getAccounts();
  } catch {
    await ctx.ui.result({
      title: 'Accounts Opened',
      tone: 'success',
      lines: [
        'Your accounts are open, but we could not load them just now. The Teller can show them to you.',
      ],
    });
    return;
  }
  await ctx.ui.table({
    title: 'Your New Accounts',
    caption: 'Your accounts and balances',
    columns: [
      { label: 'Account' },
      { label: 'Type' },
      { label: 'Number' },
      { label: 'Balance', align: 'end' },
    ],
    rows: accounts.map((a) => [
      a.nickname,
      ACCOUNT_TYPE_LABEL[a.type] ?? a.type,
      a.maskedNumber,
      balanceCell(a.balanceCents),
    ]),
    note: 'The welcome bonus is in your checking account.',
  });
}

// ---------- Check Out ----------

async function checkOutDesk(def: StationDef, ctx: StationContext) {
  const staff = speakerOf(def);
  const name = signedInName(ctx);
  if (!name) {
    await ctx.ui.dialogue({
      ...staff,
      lines: ["You're not checked in right now. The front door is back through the lobby."],
    });
    return;
  }
  const choice = await ctx.ui.dialogue<'out' | 'stay'>({
    ...staff,
    lines: [`${def.greeting} I can check you out, ${name}.`],
    choices: [
      { value: 'out', label: 'Yes, check me out' },
      { value: 'stay', label: 'Not yet' },
    ],
  });
  if (choice === 'out') await checkOut(staff, ctx);
}

async function confirmCheckOut(staff: { speaker: string; role?: string }, ctx: StationContext) {
  const sure = await ctx.ui.confirm({
    title: 'Check Out',
    text: ['Check out now? The security gate will lock behind you.'],
    confirmLabel: 'Yes, check me out',
    cancelLabel: 'Stay checked in',
  });
  if (sure) await checkOut(staff, ctx);
}

async function checkOut(staff: { speaker: string; role?: string }, ctx: StationContext) {
  await ctx.watcher.checkOut();
  await ctx.ui.dialogue({
    ...staff,
    lines: ["You're checked out. Have a lovely day, and see you soon!"],
  });
}

export function infoBoardLines() {
  return [
    'Open 24/7. (It is a demo bank, after all!)',
    BANK.disclaimer,
    'Check in at the front desk to open the security gate. New here? Visit New Accounts.',
    'Walk with W A S D or the arrow keys, or click the floor. Press E near staff to talk. Esc opens the menu.',
  ];
}
