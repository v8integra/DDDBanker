import { API_PREFIX, type ApiError, type SessionInfo } from '@dddbanker/shared';

/**
 * Typed API client. Same-origin, cookie-based. The frontend never computes
 * balances or decisions itself; it shows what the API returns.
 */
export class ApiClient {
  private csrfToken: string | null = null;

  async getSession(): Promise<SessionInfo> {
    const session = await this.request<SessionInfo>('GET', '/auth/session');
    this.csrfToken = session.authenticated ? session.csrfToken : null;
    return session;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.csrfToken && method !== 'GET' && { 'x-csrf-token': this.csrfToken }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new ApiRequestError(res.status, data as ApiError | null);
    return data as T;
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
    this.name = 'ApiRequestError';
  }
}
