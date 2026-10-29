/**
 * Demo data so every station has something to show. Safe to re-run: it does
 * nothing if the demo user already exists. For a clean slate: npm run db:reset.
 *
 * Phase 5/6 will add a credit card with history, an auto loan mid-term, and payees.
 */
import { BANK } from '@dddbanker/shared';
import { createDb } from '../src/db';
import { postTransaction } from '../src/ledger/ledger';
import { getSystemAccountId } from '../src/ledger/system-accounts';
import { transferBetweenOwnAccounts } from '../src/transfers/transfers';
import { registerUser } from '../src/users/register';

const DEMO_PASSWORD = 'bramblewood-demo-2026';
const DEMO_USERS = [
  { email: `demo@${BANK.demoEmailDomain}`, name: 'Robin Demo', creditScore: 742 },
  { email: `sam@${BANK.demoEmailDomain}`, name: 'Sam Sample', creditScore: 655 },
];

const db = createDb(process.env.DATABASE_URL ?? 'file:./prisma/dev.db');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedUser({ email, name, creditScore }: (typeof DEMO_USERS)[number]) {
  if (await db.user.findUnique({ where: { email } })) {
    console.log(`  ${email} already exists, skipping`);
    return;
  }

  const user = await registerUser(
    db,
    { email, password: DEMO_PASSWORD, name },
    { at: daysAgo(45), creditScore },
  );
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  const checking = accounts.find((a) => a.type === 'CHECKING')!;
  const savings = accounts.find((a) => a.type === 'SAVINGS')!;

  const payday = (day: number, cents: bigint) =>
    db.$transaction(async (tx) =>
      postTransaction(tx, {
        type: 'DEPOSIT',
        description: 'Payroll deposit',
        at: daysAgo(day),
        entries: [
          {
            accountId: await getSystemAccountId(tx, 'EXTERNAL_CLEARING'),
            amountCents: -cents,
            description: `Payroll for ${email}`,
          },
          {
            accountId: checking.id,
            amountCents: cents,
            description: 'Payroll: Bramblewood Bakery Co.',
          },
        ],
      }),
    );
  const save = (day: number, amountCents: number, memo: string) =>
    db.$transaction((tx) =>
      transferBetweenOwnAccounts(tx, {
        userId: user.id,
        fromAccountId: checking.id,
        toAccountId: savings.id,
        amountCents,
        memo,
        at: daysAgo(day),
      }),
    );

  await payday(30, 215_000n);
  await save(29, 40_000, 'Monthly savings');
  await payday(16, 215_000n);
  await save(15, 40_000, 'Monthly savings');
  await save(8, 12_500, 'Vacation fund');
  await payday(2, 215_000n);

  console.log(`  ${email} created`);
}

console.log('Seeding demo customers…');
for (const user of DEMO_USERS) await seedUser(user);
console.log(`Done. Sign in with any demo email and password "${DEMO_PASSWORD}".`);
await db.$disconnect();
