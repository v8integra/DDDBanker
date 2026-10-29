import { z } from 'zod';
import { amountCentsSchema, type Cents } from '../money';
import { memoSchema, type AccountSummary } from './accounts';
import { passwordSchema } from './auth';

// ---------- Limits (shown to customers, enforced by the server) ----------

export const LIMITS = {
  /** Largest single simulated deposit. */
  depositCents: 1_000_000,
  /** ATM: per bank day, and notes come in $20s. */
  atmDailyCents: 50_000,
  atmNoteCents: 2_000,
  /** Sending money to other people, per bank day. */
  p2pDailyCents: 250_000,
  /** Opening deposit needed for a CD. */
  cdMinimumCents: 50_000,
} as const;

export const CD_TERMS = [
  { months: 6, rateBps: 400 },
  { months: 12, rateBps: 425 },
  { months: 24, rateBps: 450 },
] as const;

// ---------- Accounts ----------

export const openAccountSchema = z
  .object({
    type: z.enum(['SAVINGS', 'CD']),
    nickname: z.string().trim().min(1).max(40).optional(),
    termMonths: z.coerce
      .number()
      .int()
      .refine((m) => CD_TERMS.some((t) => t.months === m), 'Choose a CD term')
      .optional(),
    fundingAccountId: z.string().min(1).optional(),
    openingDepositCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'CD') {
      if (!v.termMonths)
        ctx.addIssue({ code: 'custom', path: ['termMonths'], message: 'Choose a CD term' });
      if (!v.fundingAccountId)
        ctx.addIssue({
          code: 'custom',
          path: ['fundingAccountId'],
          message: 'Choose where the money comes from',
        });
      if ((v.openingDepositCents ?? 0) < LIMITS.cdMinimumCents) {
        ctx.addIssue({
          code: 'custom',
          path: ['openingDepositCents'],
          message: 'A CD needs at least $500.00 to open',
        });
      }
    }
    if ((v.openingDepositCents ?? 0) > 0 && !v.fundingAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['fundingAccountId'],
        message: 'Choose where the money comes from',
      });
    }
  });
export type OpenAccountInput = z.input<typeof openAccountSchema>;

export const statementMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export interface StatementLine {
  postedAt: string;
  description: string;
  amountCents: Cents;
  balanceAfterCents: Cents;
}

export interface Statement {
  account: AccountSummary;
  month: string;
  openingBalanceCents: Cents;
  closingBalanceCents: Cents;
  totalCreditsCents: Cents;
  totalDebitsCents: Cents;
  lines: StatementLine[];
}

// ---------- Deposits and withdrawals ----------

export const depositSchema = z.object({
  accountId: z.string().min(1),
  amountCents: amountCentsSchema.max(
    LIMITS.depositCents,
    'Deposits are limited to $10,000.00 at a time',
  ),
  method: z.enum(['CHECK', 'CASH']),
  channel: z.enum(['TELLER', 'ATM']).default('TELLER'),
});
export type DepositInput = z.input<typeof depositSchema>;

export const withdrawalSchema = z.object({
  accountId: z.string().min(1),
  amountCents: amountCentsSchema,
  channel: z.enum(['TELLER', 'ATM']).default('TELLER'),
});
export type WithdrawalInput = z.input<typeof withdrawalSchema>;

export interface MoneyMoveResult {
  transactionId: string;
  account: AccountSummary;
}

// ---------- People and bills ----------

export const p2pSchema = z.object({
  fromAccountId: z.string().min(1),
  toEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter their email address' })),
  amountCents: amountCentsSchema,
  memo: memoSchema,
});
export type P2PInput = z.input<typeof p2pSchema>;

export interface P2PResult {
  transactionId: string;
  from: AccountSummary;
  recipientName: string;
}

export const payeeSchema = z.object({
  name: z.string().trim().min(1, 'Enter who you are paying').max(60),
  accountRef: z
    .string()
    .trim()
    .min(4, 'Enter your account number with them')
    .max(30)
    .regex(/^[A-Za-z0-9 -]+$/, 'Letters, numbers, spaces and dashes only'),
});
export type PayeeInput = z.input<typeof payeeSchema>;

export interface Payee {
  id: string;
  name: string;
  /** Masked, e.g. "••••3321". */
  maskedRef: string;
}

export const billPaymentSchema = z.object({
  payeeId: z.string().min(1),
  fromAccountId: z.string().min(1),
  amountCents: amountCentsSchema,
  memo: memoSchema,
});
export type BillPaymentInput = z.input<typeof billPaymentSchema>;

export const FREQUENCIES = ['ONCE', 'WEEKLY', 'MONTHLY'] as const;

export const scheduledPaymentSchema = z
  .object({
    fromAccountId: z.string().min(1),
    payeeId: z.string().min(1).optional(),
    toAccountId: z.string().min(1).optional(),
    amountCents: amountCentsSchema,
    frequency: z.enum(FREQUENCIES),
    /** First run, YYYY-MM-DD (bank date). */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
    memo: memoSchema,
  })
  .refine((v) => Boolean(v.payeeId) !== Boolean(v.toAccountId), {
    message: 'Choose a payee or one of your accounts',
    path: ['payeeId'],
  });
export type ScheduledPaymentInput = z.input<typeof scheduledPaymentSchema>;

export interface ScheduledPaymentView {
  id: string;
  from: string;
  to: string;
  amountCents: Cents;
  frequency: (typeof FREQUENCIES)[number];
  nextRunDate: string;
  active: boolean;
  lastResult: string | null;
}

// ---------- Cards ----------

export type CardStatus = 'ACTIVE' | 'LOCKED' | 'REPORTED_LOST' | 'REPLACED';

export interface CardView {
  id: string;
  type: 'DEBIT' | 'CREDIT';
  last4: string;
  expiry: string;
  status: CardStatus;
  accountId: string;
  accountNickname: string;
  spendingLimitCents: Cents;
}

export const demoPurchaseSchema = z.object({
  amountCents: amountCentsSchema.optional(),
});

export interface DemoPurchaseResult {
  approved: boolean;
  merchant: string;
  amountCents: Cents;
  /** Why it was declined, in plain words. */
  reason?: string;
  account?: AccountSummary;
}

// ---------- Security ----------

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export interface TwoFactorSetup {
  /** Base32 secret to type into an authenticator app. */
  secret: string;
  /** otpauth:// URI for apps that accept a link. */
  uri: string;
}

export interface SessionView {
  id: string;
  current: boolean;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface LoginActivity {
  at: string;
  action: 'LOGIN' | 'LOGIN_FAILED' | 'LOGIN_LOCKED' | 'LOGOUT';
  ip: string | null;
}

// ---------- Support ----------

export const newTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Give your question a short subject').max(80),
  message: z.string().trim().min(5, 'Tell us a little more').max(2000),
});
export const ticketReplySchema = z.object({
  message: z.string().trim().min(1, 'Write a reply').max(2000),
});

export interface TicketView {
  id: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  updatedAt: string;
  messages: { author: 'CUSTOMER' | 'STAFF'; body: string; at: string }[];
}

// ---------- Notifications ----------

export interface NotificationView {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  read: boolean;
}
