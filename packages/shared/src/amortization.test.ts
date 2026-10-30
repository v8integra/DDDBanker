import { describe, expect, it } from 'vitest';
import { amortize, maxPrincipalForPayment, monthlyPayment } from './amortization';

describe('monthlyPayment', () => {
  it('matches the standard formula', () => {
    expect(monthlyPayment(1_600_000, 549, 60)).toBe(30_554); // $16,000 at 5.49% for 5 years
    expect(monthlyPayment(30_000_000, 625, 360)).toBe(184_715); // $300,000 at 6.25% for 30 years
  });

  it('handles zero interest and empty loans', () => {
    expect(monthlyPayment(120_000, 0, 12)).toBe(10_000);
    expect(monthlyPayment(0, 500, 12)).toBe(0);
  });
});

describe('amortize', () => {
  it('pays the loan off exactly, principal summing to the amount borrowed', () => {
    const plan = amortize(1_600_000, 549, 60);
    expect(plan.rows).toHaveLength(60);
    expect(plan.rows.at(-1)!.balanceCents).toBe(0);
    expect(plan.rows.reduce((s, r) => s + r.principalCents, 0)).toBe(1_600_000);
    expect(plan.totalPaidCents).toBe(1_600_000 + plan.totalInterestCents);
    // Interest falls and principal grows month by month.
    expect(plan.rows[0]!.interestCents).toBeGreaterThan(plan.rows[59]!.interestCents);
    expect(plan.rows[0]!.principalCents).toBeLessThan(plan.rows[58]!.principalCents);
  });

  it('only the final payment absorbs rounding', () => {
    const plan = amortize(500_000, 999, 24);
    for (const row of plan.rows.slice(0, -1)) expect(row.paymentCents).toBe(plan.paymentCents);
    expect(Math.abs(plan.rows.at(-1)!.paymentCents - plan.paymentCents)).toBeLessThan(100);
  });

  it('finishes early with a bigger payment', () => {
    const plan = amortize(1_000_000, 600, 60, 50_000);
    expect(plan.rows.length).toBeLessThan(60);
    expect(plan.rows.at(-1)!.balanceCents).toBe(0);
  });
});

describe('maxPrincipalForPayment', () => {
  it('is the inverse of monthlyPayment, never a cent over', () => {
    const principal = maxPrincipalForPayment(30_554, 549, 60);
    expect(monthlyPayment(principal, 549, 60)).toBeLessThanOrEqual(30_554);
    expect(monthlyPayment(principal + 100, 549, 60)).toBeGreaterThan(30_554);
    expect(Math.abs(principal - 1_600_000)).toBeLessThan(200);
  });
});
