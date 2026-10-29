import type { z } from 'zod';
import type { ApiError } from '@dddbanker/shared';

export interface FormErrors {
  /** Message per field name, shown under that field. */
  fields: Record<string, string>;
  /** Message for the whole form (bad credentials, lockout, server down). */
  form: string | null;
}

export const NO_ERRORS: FormErrors = { fields: {}, form: null };

/** First Zod issue per field, keyed by the top-level field name. */
export function errorsFromZod(error: z.ZodError): FormErrors {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? '_');
    fields[name] ??= issue.message;
  }
  const form = fields._ ?? null;
  delete fields._;
  return { fields, form };
}

/**
 * The server is the authority: its field errors go under fields, anything
 * else becomes a form-level message. Unknown failures get a friendly fallback.
 */
export function errorsFromApi(body: ApiError | null, fieldNames: readonly string[]): FormErrors {
  if (!body)
    return { fields: {}, form: "We couldn't reach the bank. Check your connection and try again." };
  const fields: Record<string, string> = {};
  for (const [path, message] of Object.entries(body.fields ?? {})) {
    const name = path.split('.')[0]!;
    if (fieldNames.includes(name)) fields[name] ??= message;
  }
  const hasFieldErrors = Object.keys(fields).length > 0;
  return { fields, form: hasFieldErrors && body.error === 'VALIDATION' ? null : body.message };
}

export function hasErrors(errors: FormErrors) {
  return errors.form !== null || Object.keys(errors.fields).length > 0;
}
