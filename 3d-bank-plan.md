# 3D Bank — Project Plan for Claude Code

## 1. Overview

Build a **fictional bank** whose website frontend is a **3D game environment** built with Three.js. The player walks a simple character around a small street outside the bank, enters through the front door, checks in (logs in) at the front desk, and passes through a security gate to reach banking stations. Interacting with a station opens a **retro 2D-RPG-style menu window** where the actual banking happens.

The bank is fictional and **no real money moves**, but the system should **behave like a real bank**: real authentication, real account ledgers, transfers, bill pay, cards, loans with amortization, interest accrual, statements, and server-side validation on everything.

**Placeholder bank name:** "Bramblewood Bank" (easy to change in one config file; confirm the final name isn't a real bank before publishing).

### Core principles

1. **The backend is the source of truth.** The 3D frontend is just a client. Every action goes through the same validated API a normal website would use. The gate is a visual representation of auth state; real protection is server-side authorization on every endpoint.
2. **3D for navigation, 2D for work.** Walking around is the fun part. Forms, balances, and tables live in HTML overlay windows styled like classic RPG menus.
3. **Fun and simple art.** Low-poly, bright, built mostly from primitives in code. No professional character art required.
4. **Accessible by design.** Game-style accessibility options plus WCAG 2.2 AA for all UI, a quick-travel menu, and a classic 2D view.
5. **Clearly fictional.** A visible "Demo bank. Do not enter real personal or financial information" notice on the login and signup windows.

---

## 2. Tech Stack

Developer works on **Windows** in **TypeScript**. Everything must run locally on Windows with `npm` scripts only (no bash-only scripts, no Docker requirement).

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces |
| Frontend build | Vite + TypeScript |
| 3D | Three.js |
| Physics / collision | Rapier (`@dimforge/rapier3d-compat`), kinematic character controller |
| UI overlays | Plain HTML/CSS + TypeScript (no framework required; a small component helper is fine) |
| Backend | Node.js + TypeScript + Fastify |
| Database | SQLite via Prisma (switchable to Postgres later by changing the datasource) |
| Validation | Zod schemas shared between frontend and backend |
| Auth | Session cookies (httpOnly, SameSite=Lax/Strict, Secure in prod), argon2 password hashing |
| Testing | Vitest (unit), Supertest-style API tests via Fastify `inject`, Playwright (e2e for classic view + overlay UI) |
| Lint/format | ESLint + Prettier |

### Repository layout

```
/apps
  /web        # Three.js game client + overlay UI + classic 2D view
  /api        # Fastify backend
/packages
  /shared     # Zod schemas, API types, money helpers, constants (bank name, etc.)
/docs         # this plan, API notes, accessibility checklist
```

Root scripts: `npm run dev` (runs api + web together), `npm run test`, `npm run lint`, `npm run db:migrate`, `npm run db:seed`.

---

## 3. Backend

### 3.1 Money rules (non-negotiable)

- Store all amounts as **integer cents** (`BigInt` or integer columns). Never floats.
- Use a **double-entry ledger**: every money movement creates balanced ledger entries (debit one account, credit another). Balances are derived from or reconciled against the ledger.
- Every money-moving request requires an **idempotency key** so double-clicks or retries never double-post.
- Money movements run inside **database transactions**.
- The bank has internal system accounts (cash vault, loan funding, interest expense, fees income, external clearing) so ledgers always balance.

### 3.2 Data model (initial)

- **User**: id, email, passwordHash, name, fictional address, simulated credit score (assigned at signup, e.g. 580–820), createdAt, failedLoginCount, lockedUntil, totpSecret (optional)
- **Session**: id, userId, expiresAt, lastSeenAt, ip/userAgent (for the security center)
- **Account**: id, userId, type (CHECKING, SAVINGS, CD, CREDIT_CARD, AUTO_LOAN, MORTGAGE, PERSONAL_LOAN), nickname, number (fake, generated), status, interestRateBps, createdAt
- **LedgerEntry**: id, transactionId, accountId, amountCents (signed), createdAt
- **Transaction**: id, type (DEPOSIT, WITHDRAWAL, TRANSFER, BILL_PAY, CARD_PURCHASE, LOAN_DISBURSEMENT, LOAN_PAYMENT, INTEREST, FEE, P2P), description, status (PENDING, POSTED, FAILED, REVERSED), idempotencyKey, createdAt
- **Payee**: id, userId, name, fake account reference
- **ScheduledPayment**: id, userId, fromAccountId, payeeId or toAccountId, amountCents, frequency, nextRunDate
- **Card**: id, accountId, type (DEBIT, CREDIT), last4, expiry, status (ACTIVE, LOCKED, REPORTED_LOST, REPLACED), spendingLimitCents
- **LoanApplication**: id, userId, product (AUTO, MORTGAGE, PERSONAL, CREDIT_CARD), requestedAmountCents, termMonths, details JSON, decision (PENDING, APPROVED, DECLINED, COUNTER_OFFER), offeredRateBps, decidedAt
- **Loan**: id, accountId, principalCents, rateBps, termMonths, monthlyPaymentCents, startDate, amortization generated on demand
- **InsurancePolicy / InsuranceQuote**: id, userId, type (AUTO, HOME, RENTERS, LIFE), coverage details JSON, premiumCents, status
- **SupportTicket**: id, userId, subject, messages, status
- **Notification**: id, userId, type, message, readAt
- **AuditLog**: id, userId, action, metadata, ip, createdAt

### 3.3 Business logic

- **Signup:** creates a user, checking account, and savings account, plus an opening deposit from the "welcome bonus" system account (e.g. $1,000 fake) so there is something to play with.
- **Interest accrual:** daily job (in-process scheduler) accrues savings and CD interest and posts it monthly.
- **Credit card:** statement cycles, minimum payment, APR applied to carried balance, simulated purchases (a "demo purchase" button or random seeded merchants).
- **Loans:** standard amortization formula; payments split into principal and interest; schedule viewable; extra principal payments allowed.
- **Underwriting (simulated, deterministic):** decisions based on the fictional credit score, simulated income entered on the application, and debt-to-income. Rules live in one module so they are easy to tweak. Outcomes: approve, decline with reason, or counter-offer.
- **Insurance:** quote calculator from simple inputs (vehicle year, home value, coverage level); "bind" turns a quote into a policy with a monthly premium auto-debited.
- **Limits and fees:** daily transfer limits, insufficient-funds checks (decline, no overdraft by default), optional fee rules.
- **Time travel for demos (dev/admin only):** an endpoint to advance the simulated clock by days or months so interest, statements, and loan payments can be shown quickly.

### 3.4 Security (behave like a real bank)

- argon2id password hashing; password strength rules.
- httpOnly session cookies; session rotation on login; idle timeout (e.g. 15 min) and absolute timeout.
- CSRF protection for state-changing requests.
- Rate limiting on login, signup, and money endpoints; account lockout after repeated failed logins with a cooldown.
- Optional TOTP two-factor auth (setup at the Security station).
- Zod validation on every request body and query.
- **Authorization on every endpoint:** users can only access their own accounts, cards, loans, and so on.
- Security headers (CSP, HSTS in prod, etc.) via Fastify plugins.
- Audit log for logins, failed logins, money movements, card status changes, and settings changes.
- Generic error messages for auth failures (don't reveal whether an email exists).

### 3.5 API outline

All under `/api/v1`. JSON. Shared Zod schemas in `/packages/shared`.

- **Auth:** `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/2fa/setup`, `POST /auth/2fa/verify`
- **Accounts:** `GET /accounts`, `GET /accounts/:id`, `GET /accounts/:id/transactions`, `GET /accounts/:id/statements/:month`, `POST /accounts` (open savings or CD), `PATCH /accounts/:id` (nickname)
- **Money movement:** `POST /transfers` (own accounts), `POST /p2p` (to another user by email), `POST /deposits` (simulated check or cash deposit), `POST /withdrawals` (ATM / teller)
- **Bill pay:** `GET/POST/DELETE /payees`, `POST /bill-payments`, `GET/POST/DELETE /scheduled-payments`
- **Cards:** `GET /cards`, `POST /cards/:id/lock`, `POST /cards/:id/unlock`, `POST /cards/:id/report-lost`, `POST /cards/:id/demo-purchase`
- **Loans and credit:** `POST /loan-applications`, `GET /loan-applications`, `GET /loans/:id`, `GET /loans/:id/schedule`, `POST /loans/:id/payments`, `GET /calculators/auto`, `GET /calculators/mortgage`
- **Insurance:** `POST /insurance/quotes`, `POST /insurance/quotes/:id/bind`, `GET /insurance/policies`
- **Support:** `GET/POST /support/tickets`, `POST /support/tickets/:id/messages`
- **Profile and security:** `GET/PATCH /profile`, `POST /profile/password`, `GET /security/sessions`, `DELETE /security/sessions/:id`
- **Notifications:** `GET /notifications`, `POST /notifications/:id/read`
- **Dev/admin only:** `POST /dev/advance-clock`, `POST /dev/reset-user`

### 3.6 Seed data

`npm run db:seed` creates a demo user (e.g. `demo@bramblewood.test` / documented password) with checking, savings, a credit card with some history, an auto loan mid-term, and a few payees, so every station has something to show immediately.

---

## 4. Frontend — 3D World

### 4.1 Art style

- **Low-poly, flat-shaded, bright, friendly palette.** Think toy-town or cozy indie game.
- Build almost everything from Three.js primitives (boxes, cylinders, spheres, cones) with `MeshToonMaterial` or flat `MeshStandardMaterial`.
- Optional CC0 asset packs (Kenney, Quaternius) in glTF/GLB for props like trees, benches, and plants. Keep the license file in `/apps/web/public/assets/LICENSES.md`.
- Soft directional light plus hemisphere light; simple shadows; light fog at the edges of the exterior.
- All colors and dimensions in a `theme.ts` so the style is easy to tweak.

### 4.2 Player character

- Simple chunky character built from primitives: rounded body, head, two eyes, small arms/feet. Bobbing walk animation done procedurally (no rigging needed).
- Optional color picker at signup or in settings.
- **Controls:** WASD / arrow keys to move, mouse to orbit camera, **click-to-move** on the ground, **E / Enter / click** to interact, Esc to close menus or pause. Gamepad support if cheap to add.
- Third-person follow camera with collision so it doesn't clip through walls; adjustable distance; option for fixed camera.
- Kinematic character controller via Rapier; invisible walls bound every area.

### 4.3 Scene 1: Exterior (small walkable area)

- A short city block: sidewalk, curb, a quiet street (no traffic, or a slow-moving decorative car loop), crosswalk, lamp posts, trees in planters, benches, a mailbox, flowers.
- **Bank building facade** with the bank name in large 3D letters on the side and above the door, columns or awning, windows with warm interior glow.
- An **outdoor ATM** on the wall (works like the interior teller for withdraw/deposit/balance, requires login through the ATM menu).
- Boundaries made natural with planters, fences, and building walls so the space feels intentional, not caged.
- A small sign or plaque near spawn: "Walk to the front door to enter. Press E to interact."
- Optional ambient touches: birds, drifting leaves, day/evening lighting toggle.

### 4.4 Transition into the bank

- Trigger volume at the front door. On enter: door opens, screen fades out, interior scene loads (pre-loaded in background), fade in with the player just inside the door.
- Exiting through the interior door reverses this back to the sidewalk.
- Respect reduced-motion settings (instant cut instead of fade if requested).

### 4.5 Scene 2: Interior

**Lobby (public):**
- **Check-in desk** with a friendly greeter NPC: login, forgot password (simulated), 2FA prompt.
- **New Accounts desk:** signup / open your first account.
- Waiting area seating, plants, a wall-mounted info board (bank hours, demo disclaimer, controls help).
- **Security gate** leading to the banking hall.

**Security gate behavior:**
- **Locked (not authenticated):** gate shows red light. Walking into it plays a bump/shake and a small dialog: "Please check in at the front desk first."
- **Failed login:** gate stays red; check-in dialog shows a generic error; lockout message after too many failures.
- **Authenticated:** gate light turns green, gate arms swing open with a chime.
- **Session expires or user logs out:** gate re-locks. If the player is inside the hall, show "Your session has expired" and move them back to the lobby.
- The gate is purely visual. The API rejects unauthenticated calls regardless.

**Banking hall (secured)** — each station is a desk or kiosk with a hanging sign, an icon, and an NPC teller:

| Station | Services |
|---|---|
| **Teller / Accounts** | Balances, transaction history, statements, deposits, withdrawals, open savings or CD, rename accounts |
| **Transfers & Payments** | Transfer between own accounts, send money to another user (P2P), bill pay, manage payees, scheduled payments |
| **Cards** | View cards, lock/unlock, report lost, request replacement, simulate purchase, apply for credit card |
| **Auto Loans** | Payment calculator, apply, view decision, view loan and amortization, make payment |
| **Home Loans** | Mortgage calculator, prequalification, apply, view loan and schedule, make payment |
| **Personal Loans** | Calculator, apply, view, pay |
| **Insurance** | Get quotes (auto, home, renters, life), bind policy, view policies |
| **Savings & Investments** | CDs and savings goals (simple progress tracker) |
| **Security Center** | Change password, set up 2FA, view and revoke active sessions, view recent login activity |
| **Help Desk** | Support tickets, FAQ, controls help |
| **Exit / Logout** | Log out (gate re-locks) |

- A notifications "bell" kiosk or HUD icon for alerts (payment posted, loan decision, etc.).
- Stations are defined **data-driven** in one config file (position, sign text, icon, NPC color, which menu opens), so adding new stations later is trivial. This also becomes the foundation for a future 3D mall.

### 4.6 Interaction system

- When the player is near a station, show a floating "E: Talk to Teller" prompt over it.
- Interacting pauses movement, turns the NPC toward the player, and opens that station's menu window.
- Proximity and interaction logic is generic (Interactable component with `onInteract`).

### 4.7 HUD

- Minimal: small location label ("Lobby", "Banking Hall"), signed-in name or "Not checked in", notification icon, menu/settings button, help button.
- All HUD elements are real HTML, keyboard-focusable.

---

## 5. Frontend — Retro Menu UI

### 5.1 Look and feel

- Inspired by classic 2D RPG menus: **solid dark-blue or cream window, thick bordered frame, rounded corners**, a blinking "▶" cursor next to the selected option, dialogue box at the bottom of the screen for NPC lines.
- **Typewriter text** for NPC dialogue (skippable with any key; disabled with reduced motion).
- Pixel-style font for headings (e.g. "Press Start 2P" or "Silkscreen" from Google Fonts) with a **highly readable font for body text, numbers, and inputs**. A setting switches everything to the readable font.
- Soft UI sounds (select blip, confirm, cancel, error buzz) with a mute toggle.
- Money shown with clear formatting, aligned columns, and color plus a +/- sign (never color alone).

### 5.2 Structure

- A menu window system: `openWindow(definition)` with stacked windows (main menu → submenu → form → confirmation).
- Window types: **option list**, **form** (text inputs, selects, number/currency inputs), **table/list** (transactions), **detail** (account summary), **confirm** ("Send $50.00 to Checking?" → Yes / No), **result** (success / error message).
- Every money action goes through a **confirmation window** before submitting.
- Arrow keys / W-S to move the selection, Enter to confirm, Esc / Backspace to go back. Mouse and touch also work.
- Forms use real `<input>`, `<label>`, and `<button>` elements; client-side validation with the shared Zod schemas, but the server remains authoritative and its errors display inline.
- Example flow at the Transfers station:
  1. NPC: "Welcome! What can I help you with today?"
  2. Options: Transfer between my accounts / Send money / Pay a bill / Scheduled payments / Never mind
  3. Form: From, To, Amount, Memo
  4. Confirm window
  5. Result window with new balances

---

## 6. Accessibility

Target: **WCAG 2.2 AA for all HTML UI**, plus game accessibility best practices for the 3D layer.

- **Quick-travel menu:** a list of all stations; selecting one moves the player there (or opens its menu directly). The 3D world is never required to complete a task.
- **Classic view:** a link on every screen to a plain 2D version of the site using the same API and the same menu content in a standard page layout. Fully keyboard and screen reader friendly.
- **Keyboard-only play:** everything reachable without a mouse; visible focus outlines; no keyboard traps.
- **Screen reader support:** ARIA live region announcing location changes, nearby station prompts, gate status, and dialog text. Menus use proper roles (`dialog`, `listbox`/`menu`, labelled form fields).
- **Settings panel:**
  - Remappable controls
  - Click-to-move / tap-to-move toggle
  - Camera sensitivity, invert axis, fixed camera option
  - Reduced motion (disables camera sway, fades, typewriter, bobbing)
  - Text size (at least 3 steps) and readable-font toggle
  - High-contrast UI theme
  - Colorblind-safe palette for status colors (gate red/green also uses icons and text)
  - Volume sliders and mute; captions for any spoken or sound-only cues
  - Pause at any time
- **Session timeout warning** with an option to extend (WCAG timing requirement).
- Respect `prefers-reduced-motion` and `prefers-contrast` automatically.
- Keep an accessibility checklist in `/docs/accessibility.md` and test with keyboard, NVDA (Windows), and axe in Playwright.

---

## 7. Performance

- Target smooth play on an average laptop with integrated graphics; degrade gracefully on phones.
- Instanced meshes for repeated props, merged static geometry, baked or minimal shadows, low draw-call count.
- Compress any GLB assets (Draco or meshopt) and textures (KTX2) if used.
- Pre-load the interior scene in the background while the player is outside.
- Graphics quality setting (low / medium / high) adjusting shadows, pixel ratio, and effects.
- Pause rendering when the tab is hidden or a full menu is open (or render at reduced rate).

---

## 8. Build Phases

Work in order. Each phase should end with something runnable and tests passing.

### Phase 0 — Setup
- Monorepo with npm workspaces, TypeScript configs, ESLint/Prettier, Vitest.
- `npm run dev` starts api and web together on Windows.
- Shared package with bank config (name, colors) and money helpers.

### Phase 1 — Backend core
- Prisma schema, migrations, seed script.
- Auth (signup, login, logout, session, lockout, rate limits, CSRF).
- Accounts, ledger, transactions, transfers with idempotency.
- API tests for auth, authorization (user A cannot see user B), and ledger balancing.

### Phase 2 — Exterior scene and character
- Three.js scene, lighting, sidewalk/street/facade with bank name, props, boundaries.
- Player character, controls, follow camera, Rapier collision, click-to-move.
- Settings panel shell and pause menu.

### Phase 3 — Interior, transition, and gate
- Door trigger, fade transition, interior lobby and banking hall layout.
- Interactable system and floating prompts.
- Gate tied to `/auth/session` state with locked, open, and expired behaviors.

### Phase 4 — Retro menu UI system
- Window stack, option lists, forms, tables, confirm and result windows, typewriter dialogue.
- Check-in desk (login) and New Accounts desk (signup) fully working.

### Phase 5 — Core banking stations
- Teller/Accounts, Transfers & Payments, Cards, Security Center, Help Desk, Logout.
- Outdoor ATM.
- Notifications.

### Phase 6 — Lending and insurance
- Calculators, applications, simulated underwriting, loans with amortization and payments.
- Credit card statements and APR.
- Insurance quotes and policies.
- Interest accrual job and dev clock-advance endpoint.

### Phase 7 — Accessibility and classic view
- Quick-travel menu, full settings, ARIA live announcements, high contrast, reduced motion.
- Classic 2D view covering every station's functions.
- axe checks in Playwright; manual NVDA pass.

### Phase 8 — Polish and deploy
- Sounds, small animations (NPC wave, gate chime, door), day/evening lighting.
- Graphics quality settings and performance pass.
- Production config (env vars, secure cookies, CSP), deploy docs for a simple host (e.g. a Node host for the API with Postgres, static hosting for the web app).
- README with setup steps, demo login, and screenshots.

---

## 9. Conventions for Claude Code

- TypeScript strict mode everywhere.
- Keep 3D code modular: `scenes/`, `player/`, `camera/`, `world/props/`, `interaction/`, `ui/windows/`, `ui/hud/`, `stations/`, `api/` (typed client), `settings/`.
- Stations and their menus are defined as data (config objects), not hard-coded scene logic.
- The frontend never computes balances or loan decisions itself; it displays what the API returns.
- Never log passwords, session tokens, or full request bodies for auth endpoints.
- Add or update tests with every backend feature.
- When adding visual changes, add debug helpers behind a `?debug` URL flag (collision shapes, trigger volumes, FPS counter) so problems can be described and checked easily.
- Keep this plan updated: mark phases complete and note any design changes in a "Changelog" section at the bottom.

---

## 10. Future Ideas (not in scope now)

- Reuse the engine (character, interactables, gated areas, station config, menu UI) for the **3D mall** concept: multiple storefronts, each with its own interior and stations.
- Multiplayer presence (see other customers walking around).
- Seasonal decorations on the exterior.
- Mobile touch controls with a virtual joystick.

---

## Changelog

- v0.1 — Initial plan.
