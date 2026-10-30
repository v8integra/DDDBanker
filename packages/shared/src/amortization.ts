import { applyBps, assertCents, type Cents } from './money';

/**
 * Standard fixed-payment amortization. The payment is computed once with the
 * usual annuity formula and rounded to the cent; every row after that is
 * integer cents, with interest rounded half-even, and the last payment
 * absorbs whatever rounding left over so the balance lands on exactly zero.
 */

export function monthlyPayment(principal: Cents, rateBps: number, months: number): Cents {
  assertCents(principal);
  if (principal <= 0 || months <= 0) return 0;
  if (rateBps === 0) return Math.ceil(principal / months);
  const r = rateBps / 10_000 / 12;
  return Math.round((principal * r) / (1 - (1 + r) ** -months));
}

/** Largest loan whose payment fits within `payment` (for counter-offers). */
export function maxPrincipalForPayment(payment: Cents, rateBps: number, months: number): Cents {
  if (payment <= 0 || months <= 0) return 0;
  if (rateBps === 0) return payment * months;
  const r = rateBps / 10_000 / 12;
  let principal = Math.floor((payment * (1 - (1 + r) ** -months)) / r);
  // Guard against float rounding putting us a cent over.
  while (principal > 0 && monthlyPayment(principal, rateBps, months) > payment) principal -= 1;
  return principal;
}

export interface AmortizationRow {
  n: number;
  paymentCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  balanceCents: Cents;
}

export interface Amortization {
  paymentCents: Cents;
  rows: AmortizationRow[];
  totalInterestCents: Cents;
  totalPaidCents: Cents;
}

export function amortize(
  principal: Cents,
  rateBps: number,
  months: number,
  payment = monthlyPayment(principal, rateBps, months),
): Amortization {
  const rows: AmortizationRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;
  for (let n = 1; balance > 0 && n <= 1200; n++) {
    const interest = applyBps(balance, rateBps, 12);
    let principalPart = payment - interest;
    let pay = payment;
    if (principalPart >= balance || n === months) {
      principalPart = balance;
      pay = balance + interest;
    }
    if (principalPart <= 0) break; // payment doesn't cover interest; never amortizes
    balance -= principalPart;
    totalInterest += interest;
    totalPaid += pay;
    rows.push({
      n,
      paymentCents: pay,
      interestCents: interest,
      principalCents: principalPart,
      balanceCents: balance,
    });
  }
  return {
    paymentCents: payment,
    rows,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
  };
}
