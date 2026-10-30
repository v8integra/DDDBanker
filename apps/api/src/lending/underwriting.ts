import {
  LENDING,
  formatCents,
  maxPrincipalForPayment,
  monthlyPayment,
  type Offer,
} from '@dddbanker/shared';

/**
 * Simulated, deterministic underwriting. Every rule lives here so it's easy
 * to read and tweak: same inputs, same answer, every time.
 */

export interface UnderwritingInput {
  product: keyof typeof LENDING;
  creditScore: number;
  annualIncomeCents: number;
  /** All monthly debt payments: entered on the application plus loans already at this bank. */
  monthlyDebtCents: number;
  /** Loan amount asked for (price minus down payment for auto and home). Ignored for cards. */
  amountCents: number;
  termMonths: number;
  priceCents?: number;
  downPaymentCents?: number;
  vehicleYear?: number;
  /** Bank year, for vehicle age. */
  year: number;
}

export type UnderwritingResult =
  | { decision: 'APPROVED'; offer: Offer; reason: null }
  | { decision: 'COUNTER_OFFER'; offer: Offer; reason: string }
  | { decision: 'DECLINED'; offer: null; reason: string };

const declined = (reason: string): UnderwritingResult => ({
  decision: 'DECLINED',
  offer: null,
  reason,
});

/** Rate adjustment for a credit score, or null if this score can't borrow this product. */
export function scoreAdjustmentBps(
  product: UnderwritingInput['product'],
  score: number,
): number | null {
  if (product === 'CREDIT_CARD') {
    if (score >= 760) return -300;
    if (score >= 700) return 0;
    if (score >= 650) return 300;
    if (score >= 600) return 600;
    return null;
  }
  if (score >= 760) return -75;
  if (score >= 720) return 0;
  if (score >= 680) return 125;
  if (score >= 640) return 300;
  if (score >= 600) return 550;
  if (product === 'AUTO' && score >= 580) return 850;
  return null;
}

/** Card limit: a share of income that grows with the score, rounded to $100. */
function creditLimit(score: number, annualIncomeCents: number) {
  const share = score >= 740 ? 0.15 : score >= 680 ? 0.1 : 0.06;
  const { minLimitCents, maxLimitCents } = LENDING.CREDIT_CARD;
  const raw = Math.floor((annualIncomeCents * share) / 10_000) * 10_000;
  return Math.min(maxLimitCents, Math.max(minLimitCents, raw));
}

export function underwrite(input: UnderwritingInput): UnderwritingResult {
  const monthlyIncome = Math.floor(input.annualIncomeCents / 12);
  if (monthlyIncome <= 0) return declined('We need some income to lend against.');

  const adjustment = scoreAdjustmentBps(input.product, input.creditScore);
  if (adjustment === null) {
    return declined(
      `Your credit score of ${input.creditScore} is below what we can approve for this right now.`,
    );
  }

  // ---- Credit card: a limit, not a loan amount ----
  if (input.product === 'CREDIT_CARD') {
    if (input.monthlyDebtCents > monthlyIncome * 0.5) {
      return declined('Your monthly debt payments are more than half your income.');
    }
    const limit = creditLimit(input.creditScore, input.annualIncomeCents);
    const apr = LENDING.CREDIT_CARD.baseAprBps + adjustment;
    return {
      decision: 'APPROVED',
      reason: null,
      offer: {
        amountCents: limit,
        creditLimitCents: limit,
        termMonths: 0,
        rateBps: apr,
        monthlyPaymentCents: 0,
      },
    };
  }

  // ---- Installment loans ----
  const product = LENDING[input.product];
  if (!(product.terms as readonly number[]).includes(input.termMonths)) {
    return declined(`Choose a term of ${product.terms.join(', ')} months.`);
  }
  if (input.amountCents < product.minCents) {
    return declined(
      `The smallest ${product.label.toLowerCase()} we make is ${formatCents(product.minCents)}.`,
    );
  }

  let rate = product.baseRateBps + adjustment;
  let maxTerm = Math.max(...product.terms);
  if (
    input.product === 'AUTO' &&
    input.vehicleYear !== undefined &&
    input.year - input.vehicleYear > 10
  ) {
    rate += 100; // older cars cost a little more to finance, and for less time
    maxTerm = Math.min(maxTerm, 60);
    if (input.termMonths > 60)
      return declined('For vehicles over 10 years old, the longest term is 60 months.');
  }

  if (input.product === 'MORTGAGE') {
    const price = input.priceCents ?? 0;
    const down = input.downPaymentCents ?? 0;
    if (price <= 0 || down * 100 < price * LENDING.MORTGAGE.minDownPercent) {
      return declined(
        `A home loan needs a down payment of at least ${LENDING.MORTGAGE.minDownPercent}% of the price.`,
      );
    }
  }

  // Debt-to-income: everything owed monthly, including this loan, must fit under the product's cap.
  const room = Math.floor(monthlyIncome * product.maxDti) - input.monthlyDebtCents;
  if (room <= 0)
    return declined(
      'Your existing debt payments already use up the share of income we lend against.',
    );

  const amount = Math.min(input.amountCents, product.maxCents);
  const offerFor = (amountCents: number, termMonths: number): Offer => ({
    amountCents,
    termMonths,
    rateBps: rate,
    monthlyPaymentCents: monthlyPayment(amountCents, rate, termMonths),
  });

  const asked = offerFor(amount, input.termMonths);
  if (asked.monthlyPaymentCents <= room) {
    if (amount < input.amountCents) {
      return {
        decision: 'COUNTER_OFFER',
        offer: asked,
        reason: `The most we lend for this is ${formatCents(product.maxCents)}.`,
      };
    }
    return { decision: 'APPROVED', offer: asked, reason: null };
  }

  // Too much per month. First try a longer term at the same amount...
  if (input.termMonths < maxTerm) {
    const longer = offerFor(amount, maxTerm);
    if (longer.monthlyPaymentCents <= room) {
      return {
        decision: 'COUNTER_OFFER',
        offer: longer,
        reason: `That payment is more than your income supports over ${input.termMonths} months, but it fits over ${maxTerm}.`,
      };
    }
  }
  // ...then the largest amount that fits at the longest term.
  const affordable = Math.floor(maxPrincipalForPayment(room, rate, maxTerm) / 100) * 100;
  if (affordable >= product.minCents) {
    const extra = input.product === 'PERSONAL' ? '' : ' A larger down payment would close the gap.';
    return {
      decision: 'COUNTER_OFFER',
      offer: offerFor(affordable, maxTerm),
      reason: `Based on your income and debts, we can lend up to ${formatCents(affordable)}.${extra}`,
    };
  }
  return declined('The monthly payment would be too high for your income and existing debts.');
}
