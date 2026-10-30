import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  changePasswordSchema,
  demoPurchaseSchema,
  newTicketSchema,
  ticketReplySchema,
  totpCodeSchema,
} from '@dddbanker/shared';
import { currentUser, requireAuth } from '../auth/guard';
import { changeCardStatus, demoPurchase, listCards } from '../banking/cards';
import {
  changePassword,
  confirmTwoFactor,
  disableTwoFactor,
  listSessions,
  loginActivity,
  revokeSession,
  startTwoFactorSetup,
  twoFactorEnabled,
} from '../banking/security';
import {
  closeTicket,
  listNotifications,
  listTickets,
  markNotificationsRead,
  openTicket,
  replyToTicket,
} from '../banking/support';
import type { AppDeps } from '../deps';
import { AppError } from '../errors';
import { moneyRoute } from './money';

const idParams = z.object({ id: z.string().min(1).max(64) });
const cardAction = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(['lock', 'unlock', 'report-lost', 'replace']),
});

/** Cards, security, support and notifications. */
export function serviceRoutes(deps: AppDeps): FastifyPluginAsync {
  // Money dates (notices, cards, tickets) use bank time.
  const { db, bank: clock } = deps;

  return async (app) => {
    app.addHook('preHandler', requireAuth(deps));
    const sessionId = (req: { auth: { sessionId: string } | null }) => {
      if (!req.auth)
        throw new AppError(401, 'UNAUTHENTICATED', 'Please check in at the front desk first.');
      return req.auth.sessionId;
    };

    // ---- Cards ----
    app.get('/cards', (req) => listCards(db, currentUser(req).id));
    app.post('/cards/:id/:action', async (req) => {
      const { id, action } = cardAction.parse(req.params);
      return changeCardStatus(db, currentUser(req).id, id, action, clock.now());
    });
    // Static path, so it wins over /cards/:id/:action. Idempotent like other money moves.
    moneyRoute(
      app,
      deps,
      '/cards/:id/demo-purchase',
      demoPurchaseSchema,
      (tx, user, input, at, req) =>
        demoPurchase(tx, user.id, idParams.parse(req.params).id, input.amountCents, at),
      200,
    );

    // ---- Security ----
    app.post('/profile/password', async (req, reply) => {
      await changePassword(
        db,
        currentUser(req),
        sessionId(req),
        changePasswordSchema.parse(req.body),
        clock.now(),
      );
      return reply.status(204).send();
    });
    app.get('/security/sessions', (req) =>
      listSessions(db, currentUser(req).id, sessionId(req), clock.now()),
    );
    app.delete('/security/sessions/:id', async (req, reply) => {
      await revokeSession(
        db,
        currentUser(req).id,
        sessionId(req),
        idParams.parse(req.params).id,
        clock.now(),
      );
      return reply.status(204).send();
    });
    app.get('/security/activity', (req) => loginActivity(db, currentUser(req).id));
    app.get('/auth/2fa', async (req) => ({
      enabled: await twoFactorEnabled(db, currentUser(req).id),
    }));
    app.post('/auth/2fa/setup', (req) => startTwoFactorSetup(db, currentUser(req)));
    app.post('/auth/2fa/verify', async (req, reply) => {
      await confirmTwoFactor(
        db,
        currentUser(req).id,
        totpCodeSchema.parse(req.body).code,
        clock.now(),
      );
      return reply.status(204).send();
    });
    app.post('/auth/2fa/disable', async (req, reply) => {
      await disableTwoFactor(
        db,
        currentUser(req).id,
        totpCodeSchema.parse(req.body).code,
        clock.now(),
      );
      return reply.status(204).send();
    });

    // ---- Support ----
    app.get('/support/tickets', (req) => listTickets(db, currentUser(req).id));
    app.post('/support/tickets', async (req, reply) =>
      reply
        .status(201)
        .send(
          await openTicket(db, currentUser(req).id, newTicketSchema.parse(req.body), clock.now()),
        ),
    );
    app.post('/support/tickets/:id/messages', (req) =>
      replyToTicket(
        db,
        currentUser(req).id,
        idParams.parse(req.params).id,
        ticketReplySchema.parse(req.body).message,
        clock.now(),
      ),
    );
    app.post('/support/tickets/:id/close', async (req, reply) => {
      await closeTicket(db, currentUser(req).id, idParams.parse(req.params).id, clock.now());
      return reply.status(204).send();
    });

    // ---- Notifications ----
    app.get('/notifications', (req) => listNotifications(db, currentUser(req).id));
    app.post('/notifications/read-all', async (req, reply) => {
      await markNotificationsRead(db, currentUser(req).id, clock.now());
      return reply.status(204).send();
    });
    app.post('/notifications/:id/read', async (req, reply) => {
      await markNotificationsRead(
        db,
        currentUser(req).id,
        clock.now(),
        idParams.parse(req.params).id,
      );
      return reply.status(204).send();
    });
  };
}
