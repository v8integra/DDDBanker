import { z } from 'zod';

/**
 * All money is integer cents. Never floats. These helpers are the only place
 * that converts between cents and human-readable dollar strings.
 */
export type Cents = number;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: unknown): asserts value is Cents {
  if (!isCents(value)) throw new MoneyError(`Not an integer cent amount: ${String(value)}`);
}

const DOLLAR_INPUT = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;

/**
 * Parse user-typed dollars ("12", "12.5", "$1,234.56", "-3.00") into cents
 * using string math only. Rejects more than two decimal places.
 */
export function parseDollars(input: string): Cents {
  const match = DOLLAR_INPUT.exec(input.trim());
  const whole = match?.[2];
  const fraction = match?.[3];
  if (!match || (whole === undefined && fraction === undefined)) {
    throw new MoneyError(`Not a valid dollar amount: "${input}"`);
  }
  const dollars = Number((whole ?? '0').replaceAll(',', ''));
  const cents = dollars * 100 + Number((fraction ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new MoneyError(`Amount too large: "${input}"`);
  return match[1] && cents !== 0 ? -cents : cents;
}

export interface FormatOptions {
  /** 'always' prefixes positives with "+" so sign is never shown by color alone. */
  sign?: 'auto' | 'always';
}

const GROUPED = new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 });

/** Format cents as "$1,234.56" (or "-$1,234.56" / "+$1,234.56"). */
export function formatCents(cents: Cents, { sign = 'auto' }: FormatOptions = {}): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = GROUPED.format(Math.trunc(abs / 100));
  const remainder = String(abs % 100).padStart(2, '0');
  const prefix = cents < 0 ? '-' : sign === 'always' && cents > 0 ? '+' : '';
  return `${prefix}$${dollars}.${remainder}`;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  assertCents(total);
  return total;
}

/**
 * Multiply cents by a rate in basis points (1 bp = 0.01%), rounding half to
 * even (banker's rounding). Done in BigInt so no float error creeps in.
 * `periodsPerYear` divides an annual rate, e.g. 365 for daily interest.
 */
export function applyBps(cents: Cents, bps: number, periodsPerYear = 1): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(bps) || !Number.isSafeInteger(periodsPerYear) || periodsPerYear < 1) {
    throw new MoneyError('Rate and period count must be integers');
  }
  const numerator = BigInt(cents) * BigInt(bps);
  const denominator = 10_000n * BigInt(periodsPerYear);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n !== 0n)) {
    quotient += numerator < 0n ? -1n : 1n;
  }
  return Number(quotient);
}

/** A positive cent amount, as sent in API request bodies. */
export const amountCentsSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER, 'Amount too large');

/** A dollar string from a form field, parsed to positive cents. */
export const dollarInputSchema = z.string().transform((value, ctx) => {
  try {
    const cents = parseDollars(value);
    if (cents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Amount must be greater than $0.00' });
      return z.NEVER;
    }
    return cents;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 25 or 25.50' });
    return z.NEVER;
  }
});
