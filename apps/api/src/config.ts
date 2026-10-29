import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  /** Set when running behind a reverse proxy so request IPs are read from X-Forwarded-For. */
  TRUST_PROXY: flag.default(false),
  RATE_LIMITS_ENABLED: flag.default(true),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Config = z.infer<typeof envSchema> & {
  /** Secure cookies and HSTS. On in production only. */
  secureCookies: boolean;
  sessionCookieName: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const secureCookies = parsed.NODE_ENV === 'production';
  return {
    ...parsed,
    secureCookies,
    // __Host- cookies must be Secure, so the prefix is production-only.
    sessionCookieName: secureCookies ? '__Host-bb_session' : 'bb_session',
  };
}
