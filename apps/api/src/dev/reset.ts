import type { Db, Tx } from '../db';
import { openStarterAccounts } from '../users/register';

/**
 * Dev tool: put one customer back to day one (fresh checking, savings, card
 * and welcome bonus) while keeping their login. Their transactions are
 * deleted, including the other side of each one, and every account those
 * touched has its balance and running balances replayed from what's left,
 * so the books still balance.
 */
export async function resetUser(db: Db, userId: string, at: Date) {
  await db.$transaction(async (tx) => {
    const own = (await tx.account.findMany({ where: { userId }, select: { id: true } })).map(
      (a) => a.id,
    );
    const entries = await tx.ledgerEntry.findMany({
      where: { accountId: { in: own } },
      select: { transactionId: true },
    });
    const transactionIds = [...new Set(entries.map((e) => e.transactionId))];
    // Compare ids, not userId: `NOT userId = x` would skip the bank's own accounts (userId NULL).
    const touched = await tx.ledgerEntry.findMany({
      where: { transactionId: { in: transactionIds }, accountId: { notIn: own } },
      select: { accountId: true },
      distinct: ['accountId'],
    });

    await tx.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await tx.account.deleteMany({ where: { userId } }); // cascades cards, loans, statements, schedules
    await tx.payee.deleteMany({ where: { userId } });
    await tx.scheduledPayment.deleteMany({ where: { userId } });
    await tx.supportTicket.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.loanApplication.deleteMany({ where: { userId } });
    await tx.insurancePolicy.deleteMany({ where: { userId } });
    await tx.insuranceQuote.deleteMany({ where: { userId } });
    await tx.idempotencyRecord.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    for (const { accountId } of touched) await replayBalances(tx, accountId);
    await openStarterAccounts(tx, userId, at);
  });
}

/** Recompute an account's cached balance and every entry's running balance from its ledger. */
export async function replayBalances(tx: Tx, accountId: string) {
  const entries = await tx.ledgerEntry.findMany({
    where: { accountId },
    orderBy: { id: 'asc' },
    select: { id: true, amountCents: true },
  });
  let running = 0n;
  for (const e of entries) {
    running += e.amountCents;
    await tx.ledgerEntry.update({ where: { id: e.id }, data: { balanceAfterCents: running } });
  }
  await tx.account.update({ where: { id: accountId }, data: { balanceCents: running } });
}
