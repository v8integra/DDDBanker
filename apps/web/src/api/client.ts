import {
  API_PREFIX,
  CSRF_HEADER,
  IDEMPOTENCY_HEADER,
  type AccountDetail,
  type AccountSummary,
  type ApiError,
  type BillPaymentInput,
  type CardView,
  type DemoPurchaseResult,
  type DepositInput,
  type LoginActivity,
  type LoginInput,
  type MoneyMoveResult,
  type NotificationView,
  type OpenAccountInput,
  type P2PInput,
  type P2PResult,
  type Payee,
  type PayeeInput,
  type ScheduledPaymentInput,
  type ScheduledPaymentView,
  type SessionInfo,
  type SessionView,
  type SignupInput,
  type Statement,
  type TicketView,
  type TransactionPage,
  type TransferInput,
  type TransferResult,
  type TwoFactorSetup,
  type WithdrawalInput,
} from '@dddbanker/shared';

/**
 * Typed API client. Same-origin, cookie-based. The frontend never computes
 * balances or decisions itself; it shows what the API returns.
 *
 * Money-moving calls take an idempotency key: create one per attempt (e.g.
 * per form) and reuse it on retries, so a double click can't pay twice.
 */
export class ApiClient {
  private csrfToken: string | null = null;

  // ---- Session ----
  getSession = () => this.session('GET', '/auth/session');
  login = (input: LoginInput) => this.session('POST', '/auth/login', input);
  /** Opens checking + savings with the welcome bonus, and signs you in. */
  signup = (input: SignupInput) => this.session('POST', '/auth/signup', input);
  logout = () => this.session('POST', '/auth/logout', {});
  /** "Stay checked in": slides the idle timeout forward. */
  refreshSession = () => this.session('POST', '/auth/session/refresh', {});

  // ---- Accounts ----
  getAccounts = () => this.request<AccountSummary[]>('GET', '/accounts');
  getAccount = (id: string) =>
    this.request<AccountDetail>('GET', `/accounts/${encodeURIComponent(id)}`);
  getTransactions = (id: string, before?: number) =>
    this.request<TransactionPage>(
      'GET',
      `/accounts/${encodeURIComponent(id)}/transactions?limit=10${before ? `&before=${before}` : ''}`,
    );
  getStatement = (id: string, month: string) =>
    this.request<Statement>('GET', `/accounts/${encodeURIComponent(id)}/statements/${month}`);
  renameAccount = (id: string, nickname: string) =>
    this.request<AccountSummary>('PATCH', `/accounts/${encodeURIComponent(id)}`, { nickname });
  openAccount = (input: OpenAccountInput, key: string) =>
    this.move<AccountSummary>('/accounts', input, key);

  // ---- Moving money ----
  transfer = (input: TransferInput, key: string) =>
    this.move<TransferResult>('/transfers', input, key);
  deposit = (input: DepositInput, key: string) =>
    this.move<MoneyMoveResult>('/deposits', input, key);
  withdraw = (input: WithdrawalInput, key: string) =>
    this.move<MoneyMoveResult>('/withdrawals', input, key);
  sendToPerson = (input: P2PInput, key: string) => this.move<P2PResult>('/p2p', input, key);
  payBill = (input: BillPaymentInput, key: string) =>
    this.move<MoneyMoveResult>('/bill-payments', input, key);

  getPayees = () => this.request<Payee[]>('GET', '/payees');
  addPayee = (input: PayeeInput) => this.request<Payee>('POST', '/payees', input);
  removePayee = (id: string) => this.request<void>('DELETE', `/payees/${encodeURIComponent(id)}`);
  getScheduled = () => this.request<ScheduledPaymentView[]>('GET', '/scheduled-payments');
  schedule = (input: ScheduledPaymentInput) =>
    this.request<ScheduledPaymentView[]>('POST', '/scheduled-payments', input);
  cancelScheduled = (id: string) =>
    this.request<void>('DELETE', `/scheduled-payments/${encodeURIComponent(id)}`);

  // ---- Cards ----
  getCards = () => this.request<CardView[]>('GET', '/cards');
  cardAction = (id: string, action: 'lock' | 'unlock' | 'report-lost' | 'replace') =>
    this.request<{ card: CardView; message: string }>(
      'POST',
      `/cards/${encodeURIComponent(id)}/${action}`,
      {},
    );
  demoPurchase = (id: string, key: string) =>
    this.move<DemoPurchaseResult>(`/cards/${encodeURIComponent(id)}/demo-purchase`, {}, key);

  // ---- Security ----
  changePassword = (currentPassword: string, newPassword: string) =>
    this.request<void>('POST', '/profile/password', { currentPassword, newPassword });
  getSessions = () => this.request<SessionView[]>('GET', '/security/sessions');
  revokeSession = (id: string) =>
    this.request<void>('DELETE', `/security/sessions/${encodeURIComponent(id)}`);
  getActivity = () => this.request<LoginActivity[]>('GET', '/security/activity');
  twoFactorStatus = () => this.request<{ enabled: boolean }>('GET', '/auth/2fa');
  startTwoFactor = () => this.request<TwoFactorSetup>('POST', '/auth/2fa/setup', {});
  confirmTwoFactor = (code: string) => this.request<void>('POST', '/auth/2fa/verify', { code });
  disableTwoFactor = (code: string) => this.request<void>('POST', '/auth/2fa/disable', { code });

  // ---- Support and notifications ----
  getTickets = () => this.request<TicketView[]>('GET', '/support/tickets');
  openTicket = (subject: string, message: string) =>
    this.request<TicketView>('POST', '/support/tickets', { subject, message });
  replyToTicket = (id: string, message: string) =>
    this.request<TicketView>('POST', `/support/tickets/${encodeURIComponent(id)}/messages`, {
      message,
    });
  closeTicket = (id: string) =>
    this.request<void>('POST', `/support/tickets/${encodeURIComponent(id)}/close`, {});
  getNotifications = () => this.request<NotificationView[]>('GET', '/notifications');
  markAllRead = () => this.request<void>('POST', '/notifications/read-all', {});

  private async session(method: string, path: string, body?: unknown) {
    const info = await this.request<SessionInfo>(method, path, body);
    this.csrfToken = info.authenticated ? info.csrfToken : null;
    return info;
  }

  private move<T>(path: string, body: unknown, key: string) {
    return this.request<T>('POST', path, body, { [IDEMPOTENCY_HEADER]: key });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.csrfToken && method !== 'GET' && { [CSRF_HEADER]: this.csrfToken }),
        ...extraHeaders,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 204) return undefined as T;
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

/** A fresh key for one money-moving attempt. */
export const newIdempotencyKey = () => crypto.randomUUID();
