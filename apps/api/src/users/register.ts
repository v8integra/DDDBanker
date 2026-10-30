import { randomInt } from 'node:crypto';
import { openAccount } from '../accounts/accounts';
import { issueDebitCard } from '../banking/cards';
import { hashPassword } from '../auth/passwords';
import type { Db, Tx } from '../db';
import { isUniqueViolation } from '../db';
import { AppError } from '../errors';
import { postTransaction } from '../ledger/ledger';
import { getSystemAccountId } from '../ledger/system-accounts';

export const WELCOME_BONUS_CENTS = 100_000n; // $1,000.00 of play money

export interface RegisterOptions {
  at: Date;
  /** Fixed score for seeds and tests; otherwise random in the simulated 580-820 range. */
  creditScore?: number;
}

/** Checking (with a debit card), savings, and the welcome bonus. Also used by the dev reset. */
export async function openStarterAccounts(tx: Tx, userId: string, at: Date) {
  const checking = await openAccount(tx, { userId, type: 'CHECKING', at });
  await issueDebitCard(tx, checking.id, at);
  await openAccount(tx, { userId, type: 'SAVINGS', at });
  await postTransaction(tx, {
    type: 'WELCOME_BONUS',
    description: 'Welcome bonus',
    at,
    entries: [
      {
        accountId: await getSystemAccountId(tx, 'WELCOME_BONUS'),
        amountCents: -WELCOME_BONUS_CENTS,
        description: `Welcome bonus to customer ${userId}`,
      },
      {
        accountId: checking.id,
        amountCents: WELCOME_BONUS_CENTS,
        description: 'Welcome to the Bank of Bramblewood!',
      },
    ],
  });
}

/** Create a customer with checking + savings and the welcome bonus, all-or-nothing. */
export async function registerUser(
  db: Db,
  input: { email: string; password: string; name: string },
  { at, creditScore = randomInt(580, 821) }: RegisterOptions,
) {
  // Hash outside the DB transaction: it's deliberately slow.
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, name: input.name, creditScore, createdAt: at },
      });
      await openStarterAccounts(tx, user.id, at);
      return { id: user.id, email: user.email, name: user.name };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Deliberately vague: don't confirm which emails are customers.
      throw new AppError(
        409,
        'SIGNUP_FAILED',
        "We couldn't open an account with those details. If you already bank with us, check in at the front desk.",
      );
    }
    throw err;
  }
}
