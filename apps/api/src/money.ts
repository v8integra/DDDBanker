import { assertCents, type Cents } from '@dddbanker/shared';

/** DB BigInt cents -> API number cents. Throws rather than silently losing precision. */
export function toCents(value: bigint): Cents {
  const cents = Number(value);
  assertCents(cents);
  return cents;
}
