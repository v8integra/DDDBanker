/** Every non-2xx API response has this shape. */
export interface ApiError {
  error: ApiErrorCode;
  message: string;
  /** Field-level problems for form display, keyed by dotted path. */
  fields?: Record<string, string>;
}

export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'CSRF'
  | 'INVALID_CREDENTIALS'
  | 'LOCKED'
  | 'SIGNUP_FAILED'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_NOT_OPEN'
  | 'TRANSFER_NOT_ALLOWED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export const CSRF_HEADER = 'x-csrf-token';
