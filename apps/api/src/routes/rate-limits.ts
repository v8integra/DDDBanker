/** Per-route limits, keyed by client IP. Used as `{ config: rateLimit.login }`. */
export const rateLimit = {
  login: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  signup: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  money: { rateLimit: { max: 30, timeWindow: '1 minute' } },
} as const;
