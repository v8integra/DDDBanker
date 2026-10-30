import { formatCents, type CoverageLevel, type InsuranceQuoteInput } from '@dddbanker/shared';

/**
 * Premium rules for Bramble Mutual (fictional). Simple on purpose, all in
 * one place. Yearly premium in cents, then split into 12 monthly payments.
 */
const COVERAGE_FACTOR: Record<CoverageLevel, number> = { BASIC: 0.8, STANDARD: 1, PREMIUM: 1.35 };
const COVERAGE_LABEL: Record<CoverageLevel, string> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  PREMIUM: 'Premium',
};
const MIN_MONTHLY = 1_000;

export interface Priced {
  coverageCents: number;
  monthlyPremiumCents: number;
  summary: string;
}

function lifeRatePerThousand(age: number) {
  if (age < 30) return 60; // cents per $1,000 of coverage, per year
  if (age < 40) return 80;
  if (age < 50) return 160;
  if (age < 60) return 400;
  return 900;
}

export function priceQuote(input: InsuranceQuoteInput, year: number): Priced {
  let yearly: number;
  let coverage: number;
  let summary: string;

  switch (input.type) {
    case 'AUTO': {
      const age = input.driverAge;
      const driver = age < 25 ? 1.6 : age >= 65 ? 1.15 : 1;
      const vehicle = year - input.vehicleYear > 10 ? 0.85 : 1;
      yearly =
        (60_000 + input.vehicleValueCents * 0.025) *
        driver *
        vehicle *
        COVERAGE_FACTOR[input.coverage];
      coverage = input.vehicleValueCents;
      summary = `${COVERAGE_LABEL[input.coverage]} cover for a ${input.vehicleYear} vehicle worth ${formatCents(input.vehicleValueCents)}`;
      break;
    }
    case 'HOME':
      yearly = input.homeValueCents * 0.0035 * COVERAGE_FACTOR[input.coverage];
      coverage = input.homeValueCents;
      summary = `${COVERAGE_LABEL[input.coverage]} cover for a home worth ${formatCents(input.homeValueCents)}`;
      break;
    case 'RENTERS':
      yearly = (12_000 + input.contentsValueCents * 0.01) * COVERAGE_FACTOR[input.coverage];
      coverage = input.contentsValueCents;
      summary = `${COVERAGE_LABEL[input.coverage]} cover for belongings worth ${formatCents(input.contentsValueCents)}`;
      break;
    case 'LIFE': {
      const term = { 10: 0.9, 20: 1, 30: 1.25 }[input.termYears];
      yearly = (input.coverageCents / 100_000) * lifeRatePerThousand(input.age) * term;
      coverage = input.coverageCents;
      summary = `${input.termYears}-year term life, ${formatCents(input.coverageCents)} benefit`;
      break;
    }
  }
  return {
    coverageCents: coverage,
    monthlyPremiumCents: Math.max(MIN_MONTHLY, Math.round(yearly / 12)),
    summary,
  };
}
