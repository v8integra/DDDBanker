/**
 * Demo data so every station has something to show. Safe to re-run: it does
 * nothing if the demo user already exists. For a clean slate: npm run db:reset.
 *
 * Also tops up older databases (debit cards, payees) when re-run. Phase 6 adds a
 * credit card with history and an auto loan mid-term.
 */
import { BANK } from '@dddbanker/shared';
import { demoPurchase, issueDebitCard } from '../src/banking/cards';
import { addPayee, createScheduledPayment, payBill } from '../src/banking/payments';
import { createDb } from '../src/db';
import { closeStatements, payCreditCard } from '../src/lending/creditCards';
import { acceptOffer, applyForCredit, billLoans } from '../src/lending/loans';
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

/** Every checking account gets a debit card (accounts opened before Phase 5 had none). */
async function backfillCards() {
  const bare = await db.account.findMany({ where: { type: 'CHECKING', cards: { none: {} } } });
  for (const account of bare)
    await db.$transaction((tx) => issueDebitCard(tx, account.id, new Date()));
  if (bare.length) console.log(`  issued ${bare.length} debit card(s)`);
}

/** Payees, a bill, a scheduled payment and some card purchases, once per demo customer. */
async function seedBanking(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
  if (await db.payee.count({ where: { userId: user.id } })) return;
  const checking = user.accounts.find((a) => a.type === 'CHECKING')!;
  const [power, rent] = await Promise.all([
    addPayee(
      db,
      user.id,
      { name: 'Bramblewood Power & Light', accountRef: '4421-9903' },
      daysAgo(20),
    ),
    addPayee(
      db,
      user.id,
      { name: 'Mossy Oak Apartments', accountRef: 'UNIT 4B-1200' },
      daysAgo(20),
    ),
  ]);
  await db.$transaction((tx) =>
    payBill(
      tx,
      user.id,
      { payeeId: power.id, fromAccountId: checking.id, amountCents: 8_450 },
      daysAgo(12),
    ),
  );
  const card = await db.card.findFirstOrThrow({
    where: { accountId: checking.id, status: 'ACTIVE' },
  });
  for (const [day, cents] of [
    [10, 1_275],
    [6, 4_380],
    [3, 899],
  ] as const) {
    await db.$transaction((tx) => demoPurchase(tx, user.id, card.id, cents, daysAgo(day)));
  }
  const nextMonth = new Date();
  nextMonth.setUTCDate(1);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  await createScheduledPayment(
    db,
    user.id,
    {
      fromAccountId: checking.id,
      payeeId: rent.id,
      amountCents: 95_000,
      frequency: 'MONTHLY',
      startDate: nextMonth.toISOString().slice(0, 10),
    },
    new Date(),
  );
  console.log(`  ${email}: payees, bills, card purchases, and a scheduled rent payment`);
}

console.log('Seeding demo customers…');
for (const user of DEMO_USERS) await seedUser(user);
await backfillCards();
for (const user of DEMO_USERS) await seedBanking(user.email);
await seedLending(DEMO_USERS[0]!.email);

/**
 * Robin gets a Bramble credit card with two months of history and an auto
 * loan about 14 months in, built with the real services on backdated days
 * so every balance, statement and payment is consistent.
 */
async function seedLending(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
  if (await db.loanApplication.count({ where: { userId: user.id } })) return;
  const checking = user.accounts.find((a) => a.type === 'CHECKING')!;
  const income = { annualIncomeCents: 7_200_000, monthlyDebtCents: 0 };

  // A bonus deposit so the car loan's down payment and past payments are covered.
  await db.$transaction(async (tx) =>
    postTransaction(tx, {
      type: 'DEPOSIT',
      description: 'Payroll deposit',
      at: daysAgo(430),
      entries: [
        {
          accountId: await getSystemAccountId(tx, 'EXTERNAL_CLEARING'),
          amountCents: -1_400_000n,
          description: `Bonus for ${email}`,
        },
        { accountId: checking.id, amountCents: 1_400_000n, description: 'Payroll: annual bonus' },
      ],
    }),
  );

  // Auto loan, opened ~14 months ago with autopay, then billed month by month.
  const opened = daysAgo(425);
  const auto = await applyForCredit(
    db,
    user.id,
    {
      product: 'AUTO',
      priceCents: 1_850_000,
      downPaymentCents: 250_000,
      termMonths: 60,
      vehicleYear: opened.getUTCFullYear() - 1,
      ...income,
    },
    opened,
  );
  await db.$transaction((tx) =>
    acceptOffer(
      tx,
      user.id,
      auto.id,
      { autopayFromAccountId: checking.id, downPaymentFromAccountId: checking.id },
      opened,
    ),
  );

  // Credit card, opened ~70 days ago. Purchases and a payment happen on
  // their own days below, in date order with the statements.
  const cardOpened = daysAgo(70);
  const cardApp = await applyForCredit(
    db,
    user.id,
    { product: 'CREDIT_CARD', ...income },
    cardOpened,
  );
  const { accountId: cardAccountId } = await db.$transaction((tx) =>
    acceptOffer(tx, user.id, cardApp.id, {}, cardOpened),
  );
  const card = await db.card.findFirstOrThrow({ where: { accountId: cardAccountId } });
  const purchases = new Map<number, number>([
    [66, 5_640],
    [58, 2_199],
    [41, 12_830],
    [33, 4_475],
    [19, 3_310],
    [9, 7_725],
  ]);

  // Play the past days in order: that day's card activity, then loan bills (autopay) and statements.
  for (let n = 425; n >= 1; n--) {
    const d = daysAgo(n);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const at = new Date(day.getTime() + 9 * 3_600_000);
    const cents = purchases.get(n);
    if (cents) await db.$transaction((tx) => demoPurchase(tx, user.id, card.id, cents, at));
    if (n === 30) {
      await db.$transaction((tx) =>
        payCreditCard(
          tx,
          user.id,
          cardAccountId,
          { fromAccountId: checking.id, amountCents: 5_000 },
          at,
        ),
      );
    }
    await billLoans(db, new Date(day.getTime() + 86_399_999), at);
    await closeStatements(db, day, at);
  }
  console.log(`  ${email}: auto loan (14 months in) and a Bramble credit card with statements`);
}

console.log(`Done. Sign in with any demo email and password "${DEMO_PASSWORD}".`);
await db.$disconnect();
