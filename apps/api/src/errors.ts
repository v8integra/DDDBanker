import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiError, ApiErrorCode } from '@dddbanker/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'That item') =>
  new AppError(404, 'NOT_FOUND', `${what} was not found.`);

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    fields[path] ??= issue.message;
  }
  return fields;
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler<FastifyError | AppError | ZodError>((err, req, reply) => {
    let body: ApiError;
    let status: number;

    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: err.code, message: err.message, ...(err.fields && { fields: err.fields }) };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: 'VALIDATION',
        message: 'Please check the highlighted fields.',
        fields: zodFields(err),
      };
    } else if (err.statusCode === 429) {
      status = 429;
      body = {
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
      };
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      // Fastify's own client errors: bad JSON, wrong content type, body too large.
      status = err.statusCode;
      body = { error: 'VALIDATION', message: 'The request could not be read.' };
    } else {
      req.log.error({ err }, 'unhandled error');
      status = 500;
      body = { error: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' };
    }

    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: 'NOT_FOUND', message: 'Not found.' } satisfies ApiError),
  );
}
