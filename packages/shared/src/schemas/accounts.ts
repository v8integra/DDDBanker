import { z } from 'zod';
import { amountCentsSchema, type Cents } from '../money';

export const ACCOUNT_TYPES = [
  'CHECKING',
  'SAVINGS',
  'CD',
  'CREDIT_CARD',
  'AUTO_LOAN',
  'MORTGAGE',
  'PERSONAL_LOAN',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type AccountStatus = 'OPEN' | 'FROZEN' | 'CLOSED';

export interface AccountSummary {
  id: string;
  type: AccountType;
  nickname: string;
  /** Masked, e.g. "••••4821". */
  maskedNumber: string;
  status: AccountStatus;
  balanceCents: Cents;
  interestRateBps: number;
}

export interface AccountDetail extends AccountSummary {
  number: string;
  createdAt: string;
}

export interface TransactionLine {
  entryId: number;
  transactionId: string;
  type: string;
  description: string;
  memo: string | null;
  amountCents: Cents;
  balanceAfterCents: Cents;
  postedAt: string;
}

export interface TransactionPage {
  items: TransactionLine[];
  /** Pass as `before` to fetch the next (older) page. Null when there are no more. */
  nextCursor: number | null;
}

export const transactionPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.coerce.number().int().positive().optional(),
});

export const renameAccountSchema = z.object({
  nickname: z.string().trim().min(1, 'Enter a nickname').max(40),
});

export const memoSchema = z.string().trim().max(140).optional();

export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: amountCentsSchema,
    memo: memoSchema,
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'Choose two different accounts',
    path: ['toAccountId'],
  });
export type TransferInput = z.input<typeof transferSchema>;

export interface TransferResult {
  transactionId: string;
  from: AccountSummary;
  to: AccountSummary;
}

/** Header every money-moving request must carry. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key must be URL-safe');
