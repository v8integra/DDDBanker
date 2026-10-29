import {
  API_PREFIX,
  CSRF_HEADER,
  type ApiError,
  type LoginInput,
  type SessionInfo,
} from '@dddbanker/shared';

/**
 * Typed API client. Same-origin, cookie-based. The frontend never computes
 * balances or decisions itself; it shows what the API returns.
 */
export class ApiClient {
  private csrfToken: string | null = null;

  getSession(): Promise<SessionInfo> {
    return this.session('GET', '/auth/session');
  }

  login(input: LoginInput): Promise<SessionInfo> {
    return this.session('POST', '/auth/login', input);
  }

  logout(): Promise<SessionInfo> {
    return this.session('POST', '/auth/logout', {});
  }

  /** "Stay checked in": slides the idle timeout forward. */
  refreshSession(): Promise<SessionInfo> {
    return this.session('POST', '/auth/session/refresh', {});
  }

  private async session(method: string, path: string, body?: unknown) {
    const info = await this.request<SessionInfo>(method, path, body);
    this.csrfToken = info.authenticated ? info.csrfToken : null;
    return info;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.csrfToken && method !== 'GET' && { [CSRF_HEADER]: this.csrfToken }),
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
