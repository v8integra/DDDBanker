import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  acceptOfferSchema,
  advanceClockSchema,
  bindPolicySchema,
  calculatorQuerySchema,
  insuranceQuoteSchema,
  loanApplicationSchema,
  loanPaymentSchema,
  type BankClockView,
} from '@dddbanker/shared';
import { audit } from '../audit';
import { currentUser, requireAuth } from '../auth/guard';
import { runBankDays } from '../bank/days';
import { addMonths } from '../banking/common';
import type { AppDeps } from '../deps';
import { resetUser } from '../dev/reset';
import { AppError } from '../errors';
import {
  bindQuote,
  cancelPolicy,
  createQuote,
  listPolicies,
  listQuotes,
} from '../insurance/insurance';
import { listCreditCards, listStatements, payCreditCard } from '../lending/creditCards';
import {
  acceptOffer,
  applyForCredit,
  calculate,
  getLoan,
  listApplications,
  listLoans,
  loanSchedule,
  payLoan,
} from '../lending/loans';
import { moneyRoute } from './money';
import { rateLimit } from './rate-limits';

const idParams = z.object({ id: z.string().min(1).max(64) });
const DAY_MS = 86_400_000;

/** Loans, credit cards, insurance, calculators, and (outside production) the dev time machine. */
export function lendingRoutes(deps: AppDeps): FastifyPluginAsync {
  const { db, bank, config } = deps;

  return async (app) => {
    // Calculators are public: anyone in the lobby can try numbers.
    for (const product of ['auto', 'mortgage'] as const) {
      app.get(`/calculators/${product}`, async (req) => {
        const q = calculatorQuerySchema.parse(req.query);
        return calculate(
          product === 'auto' ? 'AUTO' : 'MORTGAGE',
          q.priceCents,
          q.downPaymentCents,
          q.termMonths,
          q.rateBps,
        );
      });
    }

    await app.register(async (auth) => {
      auth.addHook('preHandler', requireAuth(deps));

      // ---- Applications and loans ----
      auth.post('/loan-applications', { config: rateLimit.money }, async (req, reply) =>
        reply
          .status(201)
          .send(
            await applyForCredit(
              db,
              currentUser(req).id,
              loanApplicationSchema.parse(req.body),
              bank.now(),
            ),
          ),
      );
      auth.get('/loan-applications', (req) =>
        listApplications(db, currentUser(req).id, bank.now()),
      );
      moneyRoute(
        auth,
        deps,
        '/loan-applications/:id/accept',
        acceptOfferSchema,
        (tx, user, input, at, req) =>
          acceptOffer(tx, user.id, idParams.parse(req.params).id, input, at),
      );

      auth.get('/loans', (req) => listLoans(db, currentUser(req).id));
      auth.get('/loans/:id', (req) =>
        getLoan(db, currentUser(req).id, idParams.parse(req.params).id),
      );
      auth.get('/loans/:id/schedule', (req) =>
        loanSchedule(db, currentUser(req).id, idParams.parse(req.params).id),
      );
      moneyRoute(auth, deps, '/loans/:id/payments', loanPaymentSchema, (tx, user, input, at, req) =>
        payLoan(tx, user.id, idParams.parse(req.params).id, input, at),
      );

      // ---- Credit cards ----
      auth.get('/credit-cards', (req) => listCreditCards(db, currentUser(req).id));
      auth.get('/credit-cards/:id/statements', (req) =>
        listStatements(db, currentUser(req).id, idParams.parse(req.params).id),
      );
      moneyRoute(
        auth,
        deps,
        '/credit-cards/:id/payments',
        loanPaymentSchema,
        (tx, user, input, at, req) =>
          payCreditCard(tx, user.id, idParams.parse(req.params).id, input, at),
      );

      // ---- Insurance ----
      auth.post('/insurance/quotes', async (req, reply) =>
        reply
          .status(201)
          .send(
            await createQuote(
              db,
              currentUser(req).id,
              insuranceQuoteSchema.parse(req.body),
              bank.now(),
            ),
          ),
      );
      auth.get('/insurance/quotes', (req) => listQuotes(db, currentUser(req).id, bank.now()));
      moneyRoute(
        auth,
        deps,
        '/insurance/quotes/:id/bind',
        bindPolicySchema,
        (tx, user, input, at, req) =>
          bindQuote(tx, user.id, idParams.parse(req.params).id, input.payFromAccountId, at),
      );
      auth.get('/insurance/policies', (req) => listPolicies(db, currentUser(req).id));
      auth.post('/insurance/policies/:id/cancel', async (req, reply) => {
        await cancelPolicy(db, currentUser(req).id, idParams.parse(req.params).id, bank.now());
        return reply.status(204).send();
      });

      // ---- Dev tools ----
      const clockView = (): BankClockView => ({
        bankTime: bank.now().toISOString(),
        offsetDays: Math.round(bank.offset / DAY_MS),
      });
      const requireDev = () => {
        if (!config.devTools) throw new AppError(404, 'DEV_DISABLED', 'Not found.');
      };
      auth.get('/dev/clock', () => {
        requireDev();
        return clockView();
      });
      auth.post('/dev/advance-clock', async (req) => {
        requireDev();
        const { days, months } = advanceClockSchema.parse(req.body);
        const before = bank.now();
        // Catch up to "now" first, so the jump processes every day in between.
        await runBankDays(db, before);
        const target = new Date(addMonths(before, months).getTime() + days * DAY_MS);
        await bank.advance(db, target.getTime() - before.getTime());
        await runBankDays(db, bank.now());
        await audit(db, {
          userId: currentUser(req).id,
          action: 'DEV_CLOCK',
          metadata: { days, months },
          at: bank.now(),
        });
        return clockView();
      });
      auth.post('/dev/reset-user', async (req, reply) => {
        requireDev();
        const user = currentUser(req);
        await resetUser(db, user.id, bank.now());
        await audit(db, { userId: user.id, action: 'DEV_RESET', at: bank.now() });
        return reply.status(204).send();
      });
    });
  };
}
