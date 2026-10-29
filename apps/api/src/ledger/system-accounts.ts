import type { Db, Tx } from '../db';

/** The bank's own accounts, so every movement has a balancing side. */
export const SYSTEM_ACCOUNTS = {
  WELCOME_BONUS: 'Welcome Bonus Fund',
  CASH_VAULT: 'Cash Vault',
  LOAN_FUNDING: 'Loan Funding',
  INTEREST_EXPENSE: 'Interest Expense',
  FEES_INCOME: 'Fees Income',
  EXTERNAL_CLEARING: 'External Clearing',
} as const;

export type SystemAccountCode = keyof typeof SYSTEM_ACCOUNTS;

export async function getSystemAccountId(db: Db | Tx, code: SystemAccountCode): Promise<string> {
  const account = await db.account.upsert({
    where: { systemCode: code },
    update: {},
    create: {
      systemCode: code,
      type: 'SYSTEM',
      nickname: SYSTEM_ACCOUNTS[code],
      number: `SYS-${code}`,
    },
    select: { id: true },
  });
  return account.id;
}
