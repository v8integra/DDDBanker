import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  billPaymentSchema,
  depositSchema,
  openAccountSchema,
  p2pSchema,
  payeeSchema,
  scheduledPaymentSchema,
  statementMonthSchema,
  withdrawalSchema,
} from '@dddbanker/shared';
import { currentUser, requireAuth } from '../auth/guard';
import { buildStatement, openDepositAccount } from '../banking/accounts';
import { deposit, withdraw } from '../banking/cash';
import {
  addPayee,
  cancelScheduledPayment,
  createScheduledPayment,
  listPayees,
  listScheduledPayments,
  payBill,
  removePayee,
  sendToPerson,
} from '../banking/payments';
import type { Tx } from '../db';
import type { AppDeps } from '../deps';
import { readIdempotencyKey, runIdempotent } from '../idempotency';
import { rateLimit } from './rate-limits';

const idParams = z.object({ id: z.string().min(1).max(64) });

type SessionUser = { id: string; email: string; name: string };

/**
 * Register a money-moving POST: authenticated, rate limited, Idempotency-Key
 * required, body validated with the shared schema, run in one DB transaction.
 */
export function moneyRoute<S extends z.ZodType>(
  app: FastifyInstance,
  deps: AppDeps,
  path: string,
  schema: S,
  run: (
    tx: Tx,
    user: SessionUser,
    input: z.output<S>,
    at: Date,
    req: FastifyRequest,
  ) => Promise<unknown>,
  statusCode = 201,
) {
  app.post(path, { preHandler: requireAuth(deps), config: rateLimit.money }, async (req, reply) => {
    const user = currentUser(req);
    const key = readIdempotencyKey(req);
    const input = schema.parse(req.body);
    const at = deps.clock.now();
    const result = await runIdempotent(
      deps.db,
      { userId: user.id, key, scope: path, payload: input, statusCode, at },
      (tx) => run(tx, user, input, at, req),
    );
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return reply.status(result.statusCode).send(result.body);
  });
}

export function moneyRoutes(deps: AppDeps): FastifyPluginAsync {
  const { db, clock } = deps;

  return async (app) => {
    // Accounts: open savings or a CD, monthly statements.
    moneyRoute(app, deps, '/accounts', openAccountSchema, (tx, user, input, at) =>
      openDepositAccount(tx, user.id, input, at),
    );
    app.get('/accounts/:id/statements/:month', { preHandler: requireAuth(deps) }, async (req) => {
      const { id, month } = z
        .object({ id: z.string().min(1), month: statementMonthSchema })
        .parse(req.params);
      return buildStatement(db, currentUser(req).id, id, month);
    });

    // Cash and checks.
    moneyRoute(app, deps, '/deposits', depositSchema, (tx, user, input, at) =>
      deposit(tx, user.id, input, at),
    );
    moneyRoute(app, deps, '/withdrawals', withdrawalSchema, (tx, user, input, at) =>
      withdraw(tx, user.id, input, at),
    );

    // Other people.
    moneyRoute(app, deps, '/p2p', p2pSchema, (tx, user, input, at) =>
      sendToPerson(tx, user, input, at),
    );

    // Bills.
    app.get('/payees', { preHandler: requireAuth(deps) }, (req) =>
      listPayees(db, currentUser(req).id),
    );
    app.post('/payees', { preHandler: requireAuth(deps) }, async (req, reply) => {
      const payee = await addPayee(
        db,
        currentUser(req).id,
        payeeSchema.parse(req.body),
        clock.now(),
      );
      return reply.status(201).send(payee);
    });
    app.delete('/payees/:id', { preHandler: requireAuth(deps) }, async (req, reply) => {
      await removePayee(db, currentUser(req).id, idParams.parse(req.params).id, clock.now());
      return reply.status(204).send();
    });
    moneyRoute(app, deps, '/bill-payments', billPaymentSchema, (tx, user, input, at) =>
      payBill(tx, user.id, input, at),
    );

    // Scheduled payments.
    app.get('/scheduled-payments', { preHandler: requireAuth(deps) }, (req) =>
      listScheduledPayments(db, currentUser(req).id),
    );
    app.post('/scheduled-payments', { preHandler: requireAuth(deps) }, async (req, reply) => {
      const user = currentUser(req);
      await createScheduledPayment(
        db,
        user.id,
        scheduledPaymentSchema.parse(req.body),
        clock.now(),
      );
      return reply.status(201).send(await listScheduledPayments(db, user.id));
    });
    app.delete('/scheduled-payments/:id', { preHandler: requireAuth(deps) }, async (req, reply) => {
      await cancelScheduledPayment(
        db,
        currentUser(req).id,
        idParams.parse(req.params).id,
        clock.now(),
      );
      return reply.status(204).send();
    });
  };
}
