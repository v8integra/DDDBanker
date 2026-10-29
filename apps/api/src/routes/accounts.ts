import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  renameAccountSchema,
  transactionPageQuerySchema,
  type AccountSummary,
  type TransactionPage,
} from '@dddbanker/shared';
import { getOwnedAccount, toAccountDetail, toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import { currentUser, requireAuth } from '../auth/guard';
import type { AppDeps } from '../deps';
import { toCents } from '../money';

const idParams = z.object({ id: z.string().min(1).max(64) });

export function accountRoutes(deps: AppDeps): FastifyPluginAsync {
  const { db, clock } = deps;

  return async (app) => {
    app.addHook('preHandler', requireAuth(deps));

    app.get('/accounts', async (req): Promise<AccountSummary[]> => {
      const accounts = await db.account.findMany({
        where: { userId: currentUser(req).id },
        orderBy: { createdAt: 'asc' },
      });
      return accounts.map(toAccountSummary);
    });

    app.get('/accounts/:id', async (req) => {
      const { id } = idParams.parse(req.params);
      return toAccountDetail(await getOwnedAccount(db, currentUser(req).id, id));
    });

    app.get('/accounts/:id/transactions', async (req): Promise<TransactionPage> => {
      const { id } = idParams.parse(req.params);
      const { limit, before } = transactionPageQuerySchema.parse(req.query);
      const account = await getOwnedAccount(db, currentUser(req).id, id);

      const entries = await db.ledgerEntry.findMany({
        where: { accountId: account.id, ...(before && { id: { lt: before } }) },
        orderBy: { id: 'desc' },
        take: limit + 1,
        include: { transaction: { select: { id: true, type: true, memo: true } } },
      });
      const page = entries.slice(0, limit);

      return {
        items: page.map((e) => ({
          entryId: e.id,
          transactionId: e.transaction.id,
          type: e.transaction.type,
          description: e.description,
          memo: e.transaction.memo,
          amountCents: toCents(e.amountCents),
          balanceAfterCents: toCents(e.balanceAfterCents),
          postedAt: e.createdAt.toISOString(),
        })),
        nextCursor: entries.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    });

    app.patch('/accounts/:id', async (req) => {
      const { id } = idParams.parse(req.params);
      const { nickname } = renameAccountSchema.parse(req.body);
      const user = currentUser(req);
      const account = await getOwnedAccount(db, user.id, id);

      const updated = await db.account.update({ where: { id: account.id }, data: { nickname } });
      await audit(db, {
        userId: user.id,
        action: 'ACCOUNT_RENAMED',
        metadata: { accountId: account.id, from: account.nickname, to: nickname },
        ip: req.ip,
        at: clock.now(),
      });
      return toAccountSummary(updated);
    });
  };
}
