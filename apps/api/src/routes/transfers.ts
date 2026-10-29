import type { FastifyPluginAsync } from 'fastify';
import { transferSchema } from '@dddbanker/shared';
import { currentUser, requireAuth } from '../auth/guard';
import type { AppDeps } from '../deps';
import { readIdempotencyKey, runIdempotent } from '../idempotency';
import { transferBetweenOwnAccounts } from '../transfers/transfers';
import { rateLimit } from './rate-limits';

export function transferRoutes(deps: AppDeps): FastifyPluginAsync {
  const { db, clock } = deps;

  return async (app) => {
    app.post(
      '/transfers',
      { preHandler: requireAuth(deps), config: rateLimit.money },
      async (req, reply) => {
        const user = currentUser(req);
        const key = readIdempotencyKey(req);
        const input = transferSchema.parse(req.body);
        const at = clock.now();

        const result = await runIdempotent(
          db,
          { userId: user.id, key, scope: 'transfers', payload: input, statusCode: 201, at },
          (tx) => transferBetweenOwnAccounts(tx, { userId: user.id, ...input, at, ip: req.ip }),
        );

        if (result.replayed) reply.header('idempotent-replayed', 'true');
        return reply.status(result.statusCode).send(result.body);
      },
    );
  };
}
