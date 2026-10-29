import type { FastifyRequest } from 'fastify';
import { CSRF_HEADER } from '@dddbanker/shared';
import type { AppDeps } from '../deps';
import { AppError } from '../errors';
import { resolveSession, safeEqual, type AuthContext } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * preHandler for every protected route: a live session is required, and
 * state-changing methods must echo the session's CSRF token in a header.
 */
export function requireAuth(deps: AppDeps) {
  return async (req: FastifyRequest) => {
    const auth = await resolveSession(deps, req, { touch: true });
    if (!auth) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please check in at the front desk first.');
    }
    if (!SAFE_METHODS.has(req.method)) {
      const sent = req.headers[CSRF_HEADER];
      if (typeof sent !== 'string' || !safeEqual(sent, auth.csrfToken)) {
        throw new AppError(
          403,
          'CSRF',
          'Your session token is missing or out of date. Please refresh.',
        );
      }
    }
    req.auth = auth;
  };
}

/** The authenticated user for a route behind requireAuth. */
export function currentUser(req: FastifyRequest) {
  if (!req.auth)
    throw new AppError(401, 'UNAUTHENTICATED', 'Please check in at the front desk first.');
  return req.auth.user;
}
