import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(254));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => new Set(value).size >= 5, 'Use a mix of different characters');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Enter your name').max(80),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Login only checks length bounds so old passwords still work if the rules change.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.input<typeof loginSchema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export type SessionInfo =
  | { authenticated: false }
  | {
      authenticated: true;
      user: SessionUser;
      csrfToken: string;
      /** ISO time the session ends if idle. Clients warn before this. */
      idleExpiresAt: string;
      absoluteExpiresAt: string;
    };
