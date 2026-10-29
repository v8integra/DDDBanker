import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, signupSchema, type SessionInfo } from '@dddbanker/shared';
import { audit } from '../audit';
import { requireAuth } from '../auth/guard';
import { verifyAgainstDummy, verifyPassword } from '../auth/passwords';
import { verifyTotp } from '../auth/totp';
import { createSession, destroySession, resolveSession, toSessionInfo } from '../auth/sessions';
import { minutesFrom } from '../clock';
import type { AppDeps } from '../deps';
import { AppError } from '../errors';
import { registerUser } from '../users/register';
import { rateLimit } from './rate-limits';

const INVALID_CREDENTIALS = new AppError(
  401,
  'INVALID_CREDENTIALS',
  'That email and password combination did not work.',
);

function lockedError(until: Date, now: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new AppError(
    423,
    'LOCKED',
    `Too many failed attempts. Check-in is paused for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  );
}

export function authRoutes(deps: AppDeps): FastifyPluginAsync {
  const { db, clock, config } = deps;

  return async (app) => {
    app.post('/auth/signup', { config: rateLimit.signup }, async (req, reply) => {
      const input = signupSchema.parse(req.body);
      const now = clock.now();
      const user = await registerUser(db, input, { at: now });
      await audit(db, { userId: user.id, action: 'SIGNUP', ip: req.ip, at: now });
      const session = await createSession(deps, req, reply, user.id);
      return reply.status(201).send(await toSessionInfo(deps, session));
    });

    app.post('/auth/login', { config: rateLimit.login }, async (req, reply) => {
      const { email, password, totpCode } = loginSchema.parse(req.body);
      const now = clock.now();
      const user = await db.user.findUnique({ where: { email } });

      if (!user) {
        await verifyAgainstDummy(password);
        await audit(db, {
          userId: null,
          action: 'LOGIN_FAILED',
          metadata: { reason: 'unknown_email' },
          ip: req.ip,
          at: now,
        });
        throw INVALID_CREDENTIALS;
      }

      if (user.lockedUntil && user.lockedUntil > now) {
        await audit(db, { userId: user.id, action: 'LOGIN_LOCKED', ip: req.ip, at: now });
        throw lockedError(user.lockedUntil, now);
      }

      /** Count a failed attempt toward lockout; throws the right error. */
      const fail = async (reason: 'password' | 'totp'): Promise<never> => {
        const { failedLoginCount } = await db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        await audit(db, {
          userId: user.id,
          action: 'LOGIN_FAILED',
          metadata: { failedLoginCount, reason },
          ip: req.ip,
          at: now,
        });
        if (failedLoginCount >= config.LOCKOUT_THRESHOLD) {
          const lockedUntil = minutesFrom(now, config.LOCKOUT_MINUTES);
          await db.user.update({
            where: { id: user.id },
            data: { lockedUntil, failedLoginCount: 0 },
          });
          throw lockedError(lockedUntil, now);
        }
        throw reason === 'password'
          ? INVALID_CREDENTIALS
          : new AppError(
              401,
              'TWO_FACTOR_INVALID',
              "That code didn't match. Codes change every 30 seconds, so try the current one.",
              {
                totpCode: "That code didn't match",
              },
            );
      };

      if (!(await verifyPassword(user.passwordHash, password))) await fail('password');

      // Two-step verification: the password was right, now ask for the code.
      if (user.totpSecret) {
        if (!totpCode) {
          throw new AppError(
            401,
            'TWO_FACTOR_REQUIRED',
            'Enter the 6-digit code from your authenticator app.',
          );
        }
        if (!verifyTotp(user.totpSecret, totpCode, now)) await fail('totp');
      }

      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await audit(db, { userId: user.id, action: 'LOGIN', ip: req.ip, at: now });
      return toSessionInfo(deps, await createSession(deps, req, reply, user.id));
    });

    app.post('/auth/logout', { preHandler: requireAuth(deps) }, async (req, reply) => {
      await audit(db, {
        userId: req.auth?.user.id ?? null,
        action: 'LOGOUT',
        ip: req.ip,
        at: clock.now(),
      });
      await destroySession(deps, req, reply);
      return { authenticated: false } satisfies SessionInfo;
    });

    // Status check for the gate and HUD. Does not extend the idle timeout.
    app.get('/auth/session', async (req) =>
      toSessionInfo(deps, await resolveSession(deps, req, { touch: false })),
    );

    // "Stay signed in" from the timeout warning.
    app.post('/auth/session/refresh', { preHandler: requireAuth(deps) }, async (req) =>
      toSessionInfo(deps, req.auth),
    );
  };
}
