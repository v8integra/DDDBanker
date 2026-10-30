import { z } from 'zod';
import { amountCentsSchema, type Cents } from '../money';

// ---------- Products (what customers see; the server enforces it) ----------

export const LENDING = {
  AUTO: {
    label: 'Auto loan',
    minCents: 500_000,
    maxCents: 10_000_000,
    terms: [36, 48, 60, 72, 84],
    baseRateBps: 549,
    maxDti: 0.45,
  },
  MORTGAGE: {
    label: 'Home loan',
    minCents: 5_000_000,
    maxCents: 150_000_000,
    terms: [180, 360],
    baseRateBps: 625,
    maxDti: 0.43,
    minDownPercent: 3,
  },
  PERSONAL: {
    label: 'Personal loan',
    minCents: 100_000,
    maxCents: 4_000_000,
    terms: [12, 24, 36, 48, 60],
    baseRateBps: 999,
    maxDti: 0.4,
  },
  CREDIT_CARD: {
    label: 'Bramble credit card',
    baseAprBps: 2199,
    minLimitCents: 50_000,
    maxLimitCents: 1_500_000,
  },
} as const;

export type LendingProduct = keyof typeof LENDING;
export type LoanProduct = Exclude<LendingProduct, 'CREDIT_CARD'>;

const income = z
  .number()
  .int()
  .min(0)
  .max(100_000_000_00, 'That income is too large for this demo');
const debt = z.number().int().min(0).max(10_000_000);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const borrower = {
  /** Yearly income before taxes, made up for the demo. */
  annualIncomeCents: income,
  /** Monthly payments on other debts outside this bank (rent not included). */
  monthlyDebtCents: debt,
};

export const loanApplicationSchema = z.discriminatedUnion('product', [
  z.object({
    product: z.literal('AUTO'),
    priceCents: amountCentsSchema,
    downPaymentCents: money,
    termMonths: z.number().int(),
    vehicleYear: z.number().int().min(1990).max(2100),
    ...borrower,
  }),
  z.object({
    product: z.literal('MORTGAGE'),
    priceCents: amountCentsSchema,
    downPaymentCents: money,
    termMonths: z.number().int(),
    ...borrower,
  }),
  z.object({
    product: z.literal('PERSONAL'),
    amountCents: amountCentsSchema,
    termMonths: z.number().int(),
    purpose: z.string().trim().min(2).max(60),
    ...borrower,
  }),
  z.object({ product: z.literal('CREDIT_CARD'), ...borrower }),
]);
export type LoanApplicationInput = z.input<typeof loanApplicationSchema>;

export const acceptOfferSchema = z.object({
  /** Pay installments automatically from this account (loans). */
  autopayFromAccountId: z.string().min(1).optional(),
  /** Where the down payment comes from (auto and home loans). */
  downPaymentFromAccountId: z.string().min(1).optional(),
});

export const loanPaymentSchema = z.object({
  fromAccountId: z.string().min(1),
  amountCents: amountCentsSchema,
});

export const calculatorQuerySchema = z.object({
  priceCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  downPaymentCents: z.coerce.number().int().min(0).default(0),
  termMonths: z.coerce.number().int().min(1).max(480),
  rateBps: z.coerce.number().int().min(0).max(4000).optional(),
});

export interface Offer {
  amountCents: Cents;
  termMonths: number;
  rateBps: number;
  monthlyPaymentCents: Cents;
  /** Credit cards: the limit and APR. */
  creditLimitCents?: Cents;
}

export type ApplicationStatus = 'OFFER' | 'ACCEPTED' | 'EXPIRED' | 'DECLINED';

export interface LoanApplicationView {
  id: string;
  product: LendingProduct;
  decision: 'APPROVED' | 'DECLINED' | 'COUNTER_OFFER';
  status: ApplicationStatus;
  reason: string | null;
  requestedAmountCents: Cents;
  /** Car and home loans: the price asked about. Down payment = price − offered amount. */
  priceCents: Cents | null;
  termMonths: number;
  offer: Offer | null;
  createdAt: string;
  expiresAt: string;
}

export interface LoanView {
  accountId: string;
  product: LoanProduct;
  nickname: string;
  maskedNumber: string;
  principalCents: Cents;
  /** Still owed (positive). */
  balanceOwedCents: Cents;
  rateBps: number;
  termMonths: number;
  monthlyPaymentCents: Cents;
  nextDueDate: string;
  amountDueCents: Cents;
  installmentsBilled: number;
  autopayFrom: string | null;
  status: 'ACTIVE' | 'PAID_OFF';
}

export interface ScheduleRow {
  n: number;
  dueDate: string;
  paymentCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  balanceCents: Cents;
}

export interface CalculatorResult {
  loanAmountCents: Cents;
  rateBps: number;
  termMonths: number;
  monthlyPaymentCents: Cents;
  totalInterestCents: Cents;
  totalPaidCents: Cents;
}

// ---------- Credit cards ----------

export interface CreditStatementView {
  periodStart: string;
  periodEnd: string;
  statementBalanceCents: Cents;
  minimumDueCents: Cents;
  dueDate: string;
  interestCents: Cents;
  feeCents: Cents;
  /** Paid toward this statement since it closed. */
  paidCents: Cents;
}

export interface CreditCardAccountView {
  accountId: string;
  nickname: string;
  maskedNumber: string;
  cardLast4: string | null;
  creditLimitCents: Cents;
  balanceOwedCents: Cents;
  availableCents: Cents;
  aprBps: number;
  statementDay: number;
  latestStatement: CreditStatementView | null;
}

// ---------- Insurance ----------

export const COVERAGE_LEVELS = ['BASIC', 'STANDARD', 'PREMIUM'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const insuranceQuoteSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('AUTO'),
    vehicleYear: z.number().int().min(1980).max(2100),
    vehicleValueCents: amountCentsSchema.max(50_000_000),
    driverAge: z.number().int().min(16).max(110),
    coverage: z.enum(COVERAGE_LEVELS),
  }),
  z.object({
    type: z.literal('HOME'),
    homeValueCents: amountCentsSchema.max(500_000_000),
    coverage: z.enum(COVERAGE_LEVELS),
  }),
  z.object({
    type: z.literal('RENTERS'),
    contentsValueCents: amountCentsSchema.max(50_000_000),
    coverage: z.enum(COVERAGE_LEVELS),
  }),
  z.object({
    type: z.literal('LIFE'),
    age: z.number().int().min(18).max(80),
    coverageCents: amountCentsSchema.max(500_000_000),
    termYears: z.union([z.literal(10), z.literal(20), z.literal(30)]),
  }),
]);
export type InsuranceQuoteInput = z.input<typeof insuranceQuoteSchema>;
export type InsuranceType = InsuranceQuoteInput['type'];

export const bindPolicySchema = z.object({ payFromAccountId: z.string().min(1) });

export interface QuoteView {
  id: string;
  type: InsuranceType;
  summary: string;
  coverageCents: Cents;
  monthlyPremiumCents: Cents;
  expiresAt: string;
  bound: boolean;
}

export interface PolicyView {
  id: string;
  number: string;
  type: InsuranceType;
  coverageCents: Cents;
  monthlyPremiumCents: Cents;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  nextPremiumDate: string;
  payFrom: string;
}

// ---------- Dev tools ----------

export const advanceClockSchema = z
  .object({
    days: z.number().int().min(0).max(400).default(0),
    months: z.number().int().min(0).max(24).default(0),
  })
  .refine((v) => v.days + v.months > 0, 'Move the clock by at least a day');

export interface BankClockView {
  bankTime: string;
  offsetDays: number;
}
