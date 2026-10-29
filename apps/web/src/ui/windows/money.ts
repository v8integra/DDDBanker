import { formatCents, type Cents } from '@dddbanker/shared';

export type MoneyTone = 'credit' | 'debit' | 'neutral';

export interface MoneyCell {
  /** What's shown: always signed for movements, so color is never the only cue. */
  text: string;
  tone: MoneyTone;
  /** Spoken form, e.g. "minus $25.00". */
  label: string;
}

/** A balance: no "+" for positive, "-" when negative (e.g. a card balance owed). */
export function balanceCell(cents: Cents): MoneyCell {
  const text = formatCents(cents);
  return {
    text,
    tone: cents < 0 ? 'debit' : 'neutral',
    label: cents < 0 ? `minus ${formatCents(-cents)}` : text,
  };
}

/** A movement in or out of an account: always signed. */
export function movementCell(cents: Cents): MoneyCell {
  const text = formatCents(cents, { sign: 'always' });
  if (cents > 0) return { text, tone: 'credit', label: `plus ${formatCents(cents)}` };
  if (cents < 0) return { text, tone: 'debit', label: `minus ${formatCents(-cents)}` };
  return { text, tone: 'neutral', label: text };
}
