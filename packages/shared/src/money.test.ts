import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  amountCentsSchema,
  applyBps,
  dollarInputSchema,
  formatCents,
  parseDollars,
  sumCents,
} from './money';

describe('parseDollars', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['.99', 99],
    ['$1,234.56', 123456],
    ['  42.00 ', 4200],
    ['-3.10', -310],
    ['0.10', 10],
    ['0.29', 29], // 0.29 * 100 = 28.999... in float math
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseDollars(input)).toBe(cents);
  });

  it.each(['', '$', '.', '1.234', 'abc', '12,34', '1,2345', '--1', '1e5', '99999999999999999'])(
    'rejects %j',
    (input) => {
      expect(() => parseDollars(input)).toThrow(MoneyError);
    },
  );
});

describe('formatCents', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCents(-2500)).toBe('-$25.00');
  });

  it('shows "+" for positives when asked, never on zero', () => {
    expect(formatCents(100, { sign: 'always' })).toBe('+$1.00');
    expect(formatCents(0, { sign: 'always' })).toBe('$0.00');
    expect(formatCents(-100, { sign: 'always' })).toBe('-$1.00');
  });

  it('refuses non-integer amounts', () => {
    expect(() => formatCents(1.5)).toThrow(MoneyError);
  });

  it('round-trips with parseDollars', () => {
    for (const cents of [0, 1, 99, 100, 123456, -98765]) {
      expect(parseDollars(formatCents(cents))).toBe(cents);
    }
  });
});

describe('sumCents', () => {
  it('adds integer cents and rejects floats', () => {
    expect(sumCents([100, -50, 25])).toBe(75);
    expect(() => sumCents([1, 0.5])).toThrow(MoneyError);
  });
});

describe('applyBps', () => {
  it('applies an annual rate', () => {
    expect(applyBps(100_000, 450)).toBe(4500); // $1,000 at 4.50%
  });

  it('rounds half to even', () => {
    expect(applyBps(50, 100)).toBe(0); // 0.5 -> 0
    expect(applyBps(150, 100)).toBe(2); // 1.5 -> 2
    expect(applyBps(250, 100)).toBe(2); // 2.5 -> 2
    expect(applyBps(-150, 100)).toBe(-2);
  });

  it('divides by periods for daily accrual', () => {
    // $10,000 at 3.65% for one day = $1.00
    expect(applyBps(1_000_000, 365, 365)).toBe(100);
  });
});

describe('schemas', () => {
  it('amountCentsSchema accepts positive integers only', () => {
    expect(amountCentsSchema.safeParse(500).success).toBe(true);
    expect(amountCentsSchema.safeParse(0).success).toBe(false);
    expect(amountCentsSchema.safeParse(1.5).success).toBe(false);
    expect(amountCentsSchema.safeParse('500').success).toBe(false);
  });

  it('dollarInputSchema parses form strings to cents', () => {
    expect(dollarInputSchema.parse('25.50')).toBe(2550);
    expect(dollarInputSchema.safeParse('0').success).toBe(false);
    expect(dollarInputSchema.safeParse('-5').success).toBe(false);
    expect(dollarInputSchema.safeParse('lots').success).toBe(false);
  });
});
