import { describe, expect, it } from 'vitest';
import { priceQuote } from '../src/insurance/pricing';
import {
  scoreAdjustmentBps,
  underwrite,
  type UnderwritingInput,
} from '../src/lending/underwriting';
import { dailyInterestMilli } from '../src/bank/interest';

const personal = (over: Partial<UnderwritingInput> = {}): UnderwritingInput => ({
  product: 'PERSONAL',
  creditScore: 730,
  annualIncomeCents: 6_000_000, // $60,000
  monthlyDebtCents: 0,
  amountCents: 1_000_000,
  termMonths: 36,
  year: 2026,
  ...over,
});

describe('underwriting', () => {
  it('approves a comfortable loan at the base rate for a good score', () => {
    const r = underwrite(personal());
    expect(r.decision).toBe('APPROVED');
    expect(r.offer).toMatchObject({ amountCents: 1_000_000, termMonths: 36, rateBps: 999 });
  });

  it('prices by score tier', () => {
    expect(underwrite(personal({ creditScore: 800 })).offer!.rateBps).toBe(924);
    expect(underwrite(personal({ creditScore: 650 })).offer!.rateBps).toBe(1299);
    expect(scoreAdjustmentBps('PERSONAL', 590)).toBeNull();
    expect(scoreAdjustmentBps('AUTO', 590)).toBe(850);
  });

  it('declines low scores with a reason', () => {
    const r = underwrite(personal({ creditScore: 590 }));
    expect(r).toMatchObject({ decision: 'DECLINED', offer: null });
    expect(r.reason).toMatch(/590/);
  });

  it('counter-offers a longer term when the payment is just too high', () => {
    // $60k income: 40% DTI room is $2,000/month. With $1,500 other debt, $500 left.
    const r = underwrite(
      personal({ monthlyDebtCents: 150_000, amountCents: 1_800_000, termMonths: 36 }),
    );
    expect(r.decision).toBe('COUNTER_OFFER');
    expect(r.offer!.termMonths).toBe(60);
    expect(r.offer!.monthlyPaymentCents).toBeLessThanOrEqual(50_000);
  });

  it('counter-offers a smaller amount when even the longest term is too much', () => {
    const r = underwrite(personal({ monthlyDebtCents: 170_000, amountCents: 3_000_000 }));
    expect(r.decision).toBe('COUNTER_OFFER');
    expect(r.offer!.amountCents).toBeLessThan(3_000_000);
    expect(r.offer!.monthlyPaymentCents).toBeLessThanOrEqual(30_000);
    expect(r.reason).toMatch(/up to/);
  });

  it('declines when existing debts already use up the room', () => {
    expect(underwrite(personal({ monthlyDebtCents: 250_000 })).decision).toBe('DECLINED');
  });

  it('needs at least 3% down on a home', () => {
    const home = {
      product: 'MORTGAGE' as const,
      termMonths: 360,
      annualIncomeCents: 20_000_000,
      priceCents: 30_000_000,
    };
    expect(
      underwrite(personal({ ...home, amountCents: 29_500_000, downPaymentCents: 500_000 })).reason,
    ).toMatch(/3%/);
    expect(
      underwrite(personal({ ...home, amountCents: 27_000_000, downPaymentCents: 3_000_000 }))
        .decision,
    ).toBe('APPROVED');
  });

  it('limits old vehicles to 60 months at a higher rate', () => {
    const car = { product: 'AUTO' as const, amountCents: 1_200_000, vehicleYear: 2012 };
    expect(underwrite(personal({ ...car, termMonths: 72 })).decision).toBe('DECLINED');
    expect(underwrite(personal({ ...car, termMonths: 60 })).offer!.rateBps).toBe(549 + 100);
  });

  it('sizes card limits from income and score', () => {
    const card = (score: number) =>
      underwrite(
        personal({ product: 'CREDIT_CARD', creditScore: score, annualIncomeCents: 7_200_000 }),
      );
    expect(card(760).offer).toMatchObject({ creditLimitCents: 1_080_000, rateBps: 1899 });
    expect(card(690).offer).toMatchObject({ creditLimitCents: 720_000, rateBps: 2499 });
    expect(card(590).decision).toBe('DECLINED');
  });
});

describe('insurance pricing', () => {
  it('prices each product from simple inputs', () => {
    expect(
      priceQuote({ type: 'HOME', homeValueCents: 30_000_000, coverage: 'STANDARD' }, 2026),
    ).toMatchObject({ monthlyPremiumCents: 8_750 });
    expect(
      priceQuote({ type: 'RENTERS', contentsValueCents: 2_000_000, coverage: 'BASIC' }, 2026),
    ).toMatchObject({ monthlyPremiumCents: 2_133 });
    const young = priceQuote(
      {
        type: 'AUTO',
        vehicleYear: 2022,
        vehicleValueCents: 2_000_000,
        driverAge: 21,
        coverage: 'STANDARD',
      },
      2026,
    );
    const adult = priceQuote(
      {
        type: 'AUTO',
        vehicleYear: 2022,
        vehicleValueCents: 2_000_000,
        driverAge: 40,
        coverage: 'STANDARD',
      },
      2026,
    );
    expect(young.monthlyPremiumCents).toBeGreaterThan(adult.monthlyPremiumCents);
    expect(
      priceQuote({ type: 'LIFE', age: 35, coverageCents: 50_000_000, termYears: 20 }, 2026)
        .monthlyPremiumCents,
    ).toBe(3_333);
  });

  it('never charges less than $10 a month', () => {
    expect(
      priceQuote({ type: 'LIFE', age: 20, coverageCents: 1_000_000, termYears: 10 }, 2026)
        .monthlyPremiumCents,
    ).toBe(1_000);
  });
});

describe('daily interest', () => {
  it('accrues in thousandths of a cent', () => {
    // $10,000 at 3.65% is exactly $1.00 a day.
    expect(dailyInterestMilli(1_000_000n, 365)).toBe(100_000n);
    expect(dailyInterestMilli(1_000_000n, 365, 3)).toBe(300_000n);
    expect(dailyInterestMilli(0n, 350)).toBe(0n);
    // $10 at 3.50%: ~0.0959 cents a day, which a cents-only ledger would round to nothing.
    expect(dailyInterestMilli(1_000n, 350)).toBe(96n);
  });
});
