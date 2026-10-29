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

### Phase 0 — Setup ✅ (2026-10-29)
- Monorepo with npm workspaces, TypeScript configs, ESLint/Prettier, Vitest.
- `npm run dev` starts api and web together on Windows.
- Shared package with bank config (name, colors) and money helpers.

### Phase 1 — Backend core ✅ (2026-10-29)
- Prisma schema, migrations, seed script.
- Auth (signup, login, logout, session, lockout, rate limits, CSRF).
- Accounts, ledger, transactions, transfers with idempotency.
- API tests for auth, authorization (user A cannot see user B), and ledger balancing.

### Phase 2 — Exterior scene and character ✅ (2026-10-29)
- Three.js scene, lighting, sidewalk/street/facade with bank name, props, boundaries.
- Player character, controls, follow camera, Rapier collision, click-to-move.
- Settings panel shell and pause menu.

### Phase 3 — Interior, transition, and gate ✅ (2026-10-29)
- Door trigger, fade transition, interior lobby and banking hall layout.
- Interactable system and floating prompts.
- Gate tied to `/auth/session` state with locked, open, and expired behaviors.

### Phase 4 — Retro menu UI system ✅ (2026-10-29)
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
- v0.2 (2026-10-29) — Phase 0 complete.
  - Plan moved to `docs/3d-bank-plan.md`. Packages are scoped `@dddbanker/*` so the bank name can change freely.
  - Display name is **Bank of Bramblewood** (`BANK.name` in `packages/shared/src/bank.ts`); confirmed fictional, no real bank uses it.
  - App code holds money as `number` integer cents (`Cents`, checked with `Number.isSafeInteger`). Rate math (`applyBps`) runs in BigInt with banker's rounding. Phase 1 will store cents as Prisma `BigInt` columns and convert at the repository boundary.
  - Shared package is consumed as TypeScript source (no build step); the API runs through `tsx` in dev. A bundled API build gets added in Phase 8.
  - Dev ports: API `127.0.0.1:3001`, web `127.0.0.1:5173`, with Vite proxying `/api` so cookies are same-origin.
  - Planned for Phase 1: `db:migrate` / `db:seed` root scripts, and `@node-rs/argon2` (prebuilt Windows binaries) instead of `argon2`.
  - Toolchain at setup: Node 24, TypeScript 6, Vite 8, Vitest 5, Fastify 5, Zod 4, ESLint 10.
- v0.3 (2026-10-29) — Phase 1 complete.
  - **Prisma 7.10.1** (pinned; npm's `latest` tag pointed at an 8.0 RC) with the **libSQL driver adapter** for SQLite: it ships prebuilt Windows binaries, so no native build or install script is needed. Datasource URL lives in `apps/api/prisma.config.ts`. The generated client goes to `apps/api/src/generated/` (gitignored) and is rebuilt automatically before `dev`, `test`, `typecheck` and `db:seed`.
  - **Money columns are `BigInt` cents.** `Account.balanceCents` is a cached balance updated in the same DB transaction as the ledger entries. Tests assert that it always equals the sum of the account's entries, that every transaction sums to zero, and that all balances (customers + system) sum to zero.
  - **Debits use a conditional update** (`balance >= amount` checked in the same statement), so concurrent withdrawals can't overdraw. Customer checking, savings and CDs can't go negative; system, card and loan accounts can.
  - `LedgerEntry` gained a per-side `description` ("Transfer to Savings" / "Transfer from Checking") and a `balanceAfterCents` running balance for history and statements. Entry ids are autoincrement so history paging is a simple cursor.
  - System accounts are `Account` rows with `userId = null` and a `systemCode` (WELCOME_BONUS, CASH_VAULT, LOAN_FUNDING, INTEREST_EXPENSE, FEES_INCOME, EXTERNAL_CLEARING), created on first use. Account type `SYSTEM` added.
  - **Idempotency moved to its own table** (`IdempotencyRecord`, unique per user + key) instead of a column on `Transaction`. It stores a hash of route + body and the response; the record commits in the same DB transaction as the money movement. Same key and same body replays the response (`Idempotent-Replayed: true`); same key with a different body returns 422. Only successes are stored, since a failed attempt moved nothing.
  - **Sessions:** a random 256-bit cookie token, with only its SHA-256 stored. `httpOnly`, `SameSite=Strict`, `Secure` and the `__Host-` prefix in production. Rotated on login and signup. 15-minute idle and 12-hour absolute timeouts. `GET /auth/session` does **not** extend the idle timer (so the gate can poll it); `POST /auth/session/refresh` added for the timeout warning's "stay signed in".
  - **CSRF:** per-session synchronizer token returned in the session info and required as `X-CSRF-Token` on every state-changing authenticated request. Login and signup rely on JSON-only bodies (the `text/plain` parser is removed, so cross-site forms get 415).
  - **Lockout:** 5 failed logins locks check-in for 15 minutes (423). Unknown emails and wrong passwords get the same 401 and the same argon2 timing. Rate limits are per IP: login 10/min, signup 5/min, money 30/min. Signup with an existing email gets a vague 409.
  - Passwords: argon2id (`@node-rs/argon2`, OWASP baseline 19 MiB / t=2), minimum 12 characters.
  - Endpoints done: `POST /auth/signup|login|logout|session/refresh`, `GET /auth/session`, `GET /accounts`, `GET /accounts/:id`, `GET /accounts/:id/transactions?limit&before`, `PATCH /accounts/:id`, `POST /transfers`. Deferred to Phase 5: `POST /accounts` (opening savings or CDs), statements, P2P, deposits and withdrawals.
  - A `Clock` is injected everywhere timestamps are made, so tests can move time. Phase 6's simulated bank clock builds on it.
  - The API dev server uses `node --watch --import tsx` instead of `tsx watch`, which hung before starting when launched under `npm run` or `concurrently` on Windows.
  - Seed: `demo@bramblewood.test` and `sam@bramblewood.test` / `bramblewood-demo-2026`, with payroll deposits and savings transfers over the past month. The card, loan and payee seed data come with Phases 5–6.
- v0.4 (2026-10-29) — Phase 2 complete.
  - **Three.js 0.186 + Rapier 0.21** (`@dimforge/rapier3d-compat`, WebAssembly embedded, no bundler plugin). Units are meters; +Z points from the street toward the bank door. All colors and dimensions live in `apps/web/src/theme.ts`.
  - **Art:** everything is primitives with a shared 3-band `MeshToonMaterial` per color. Static scenery goes through a `StaticBatcher` that merges geometry per material, so the whole block is about 100 draw calls and about 33k triangles (144 fps in the dev browser). No external assets or CC0 packs yet, so there's no LICENSES file yet.
  - **Bank name:** Three.js no longer ships sample fonts, so 3D signage uses a built-in 5×7 **block font** (`world/props/blockFont.ts`, A–Z, 0–9 and a little punctuation), with each sign drawn as one InstancedMesh. Small text (the welcome plaque) is a canvas texture. "Name on the side" became a vertical blade sign ("BANK") on the facade, since neighboring shops cover the bank's side walls.
  - **Street:** sidewalks, curbs, a road with lane dashes and a zebra crossing, lamp posts, trees in planters, benches, a mailbox, flower planters, an outdoor ATM (a prop for now; it works in Phase 5), and neighboring shops (Bakery, Books, Flowers, Cafe). Bounds look natural: hedges with picket fences on the sidewalks, "road closed" barricades with cones across the street, and invisible walls just behind them.
  - **Player:** a bean-shaped character (capsule body, head, cap, eyes, cheeks, arms, feet) with procedural walk, bob and lean, plus idle breathing. The Rapier kinematic character controller uses autostep (curbs and entrance steps) and snap-to-ground. Walk 4 m/s, run (Shift) 6.5 m/s. Character color is picked in Settings, with six options.
  - **Camera:** third-person orbit (drag, Z/C keys, right stick), zoom (wheel, +/−). A raycast pulls the camera in when scenery is in the way. Fixed-camera option. Movement is camera-relative.
  - **Click-to-move:** a short press without dragging counts as a click; a drag orbits the camera. It raycasts only the ground surfaces, clamps the target to the walkable bounds, shows a pulsing ring, and gives up if blocked for 0.6 s. Keyboard or stick input cancels it.
  - **Gamepad:** left stick walks, right stick looks, A interacts, Start pauses, LB or stick-click runs. It's the standard mapping, untested on real hardware.
  - **UI:** the HUD (location, check-in status from `GET /auth/session`, help and menu buttons, a polite live region, a first-run controls hint with touch wording on touch-only devices) is real HTML. Pause, Settings and Controls are native modal `<dialog>`s in a shared `DialogStack`, which handles focus containment, Escape, focus return, and pausing the game while any window is open. The retro window style lives in `style.css` and Phase 4 builds on it. Fonts are Press Start 2P for headings and Atkinson Hyperlegible for everything else (Google Fonts).
  - **Settings (saved per browser, every field validated on load):** look sensitivity, invert Y, fixed camera, click-to-move, reduced motion (defaults from `prefers-reduced-motion`), text size 100/112.5/125/150%, readable-font toggle, high-contrast menus (defaults from `prefers-contrast`), graphics quality (pixel ratio and shadow map; touch phones default to Low), character color. Not built yet: remappable controls (Phase 7), volume (Phase 8, no sounds yet), colorblind palette (Phase 7).
  - **`?debug`:** an FPS, draw call, triangle, position and camera readout; Rapier collider wireframes (F3 toggles them); `window.__game` for poking at the player, camera, physics and settings from the console.
  - **Rendering pauses** while a menu is open (the last frame stays on screen). The frame time is clamped to 50 ms so tab switches don't cause big jumps.
  - **Checked in the browser:** walking climbs both entrance steps and stops at the door; running stops at the hedge boundary; click-to-move arrives within 0.15 m; Escape → Tab → Enter opens Settings; settings apply live and persist; Reset updates the controls; two Escapes return focus to the game; no console errors at desktop or 375 px width.
  - Production bundle is 5 MB raw / 1.8 MB gzip, mostly Rapier's embedded WebAssembly plus Three.js. Code-splitting and preloading are in Phase 8's performance pass.
- v0.5 (2026-10-29) — Phase 3 complete.
  - **Two levels, two physics worlds.** `levels/exterior.ts` (the street) and `levels/interior.ts` (lobby + banking hall) each own a Three.js scene, a Rapier world, a `Player` capsule, and a `FollowCamera`. They share one `Character` (the visuals) and one camera, which move between scenes at the doors. Rapier's WebAssembly loads once. `game/game.ts` runs the loop and everything else; `main.ts` just boots it. The interior is built in the background right after the street appears.
  - **Doors:** animated `DoubleDoor` panels (they replace the old static ones). Walking into the doorway, pressing E there, or clicking the door goes through: door swings open, fade out, swap level, fade in, door closes behind you. With reduced motion, the swing and fades are instant. Inside, the closed doors are solid, so the camera can't look out through the doorway.
  - **Interior layout** (its own coordinates, door at z = 0): lobby x ±10, z 0–12, with a gate wall at z = 12 and a 3.6 m arch. Banking hall x ±15, z 12–36. 6 m ceilings, solid so the camera stays inside. Wood paneling, rugs, ceiling lights, columns, plants, waiting chairs, an information board, and a decorative vault door on the hall's back wall.
  - **Stations are data** (`stations/stations.ts`): id, sign title and icon, room, position, facing, staff look (name, role, color, skin tone, tie or bow), greeting, planned services, and kind (desk, round help desk, or self-service kiosk). The scene builds whatever is listed. There are 14: Check-In and New Accounts in the lobby; Teller, Transfers, Cards, Savings, Auto/Home/Personal Loans, Insurance, Security Center, Check Out, a round Help Desk, and a Notices kiosk in the hall. Tests check the layout stays valid: unique ids, everything inside its room, prompts don't overlap, staff face customers, and the door-to-gate path is clear.
  - **Staff:** `Npc` reuses `Character` with outfits (tie or bow, hair) and five skin tones. They breathe at idle and turn to face you when you talk to them.
  - **Interaction system:** generic `Interactable` (prompt, standing spot, reach, anchor, click targets, `onInteract`) with `pickInteractable`, which picks the nearest thing in reach, nudged toward what you're facing. A floating "E  Talk to Rowan (Teller)" button shows over the target. It's clickable and tappable, kept out of the tab order, and every change is announced to screen readers. E, Enter, gamepad A, tapping the prompt, or clicking the person or sign (which walks you over first) all work. `TriggerZone` fires once per entry, for doorways and the gate.
  - **Security gate:** posts with lights, glass arms that swing into the hall, and a sign over the arch. Status uses color, an icon and words ("⛔ Please check in first" / "✓ Welcome, come on in"). A physics barrier exists only while it's locked. Walking into it shakes it and shows a toast. A `SessionWatcher` keeps the client in step with `GET /auth/session` (on load, every 30 s, when the tab regains focus, and right when the idle timeout should hit). Checking in opens the gate. If the session ends while you're in the hall, the fade moves you back to the lobby: an expired session shows a "your session has expired" message; checking out on purpose just shows a toast. The API still rejects unauthenticated calls regardless.
  - **Timeout warning (WCAG 2.2.1):** "Still there?" appears 2 minutes before the idle timeout with a live countdown, "Stay checked in" (`POST /auth/session/refresh`), or "Check out now". Timers use a new **`serverTime`** field in the session info, so a wrong local clock can't break them. (This was planned for Phase 7; it landed early because the gate needed it.)
  - **Station behavior for now:** a bottom-of-screen dialogue box (modal, focus kept inside, Escape closes) with the staff member's greeting and what the station will offer. **Check Out already works** (real logout with a confirmation). Check-In and New Accounts say their windows are coming; Phase 4 replaces them with the login and signup windows. The outdoor ATM and the welcome sign can be used too.
  - **`?debug` additions:** `__game.login(email, password)` and `__game.logout()` to test the gate before the check-in window exists; `__game.level`, `.player` and `.follow` follow the active level. The collider wireframes follow the active scene.
  - **Checked in the browser:** walking into the doors and pressing E both enter; the arrival spot leaves the camera room; walking into the locked gate stops you with a toast and an announcement; logging in as `demo@` turns the gate green and opens it; the hall shows "Banking Hall"; E at the teller and clicking the Help Desk person both open their dialogue, with staff and player turning to face each other; Check Out logs out on the server, re-locks the gate and moves you to the lobby; a session killed behind the client's back gives the expiry flow; the timeout warning counts down and "Stay checked in" resets the server's idle timer to 15 minutes; the exit doorway returns you to the street facing out; a page reload keeps the session and the gate starts open.
  - Known rough edges: the interior is about 360 draw calls (staff and signs aren't batched yet, a Phase 8 item). Leaving the bank starts the camera close to you because the bank wall is behind it; it eases out as you walk away.
- v0.6 (2026-10-29) — Phase 4 complete.
  - **Window system** (`ui/windows/windows.ts`, class `Windows`): `dialogue`, `options`, `form`, `table`, `detail`, `confirm`, `result`. Each window is a native modal `<dialog>` on the shared `DialogStack`, so windows stack (menu → form → confirm → result), focus stays in the top one, Escape or **Backspace** backs out one level, and focus returns where it was. Every method returns a promise that resolves when the window closes, so station flows read top to bottom.
  - **Menu keys** (`menuKeys.ts`, installed once): ↑/↓ or W/S move the ▶ cursor (wrapping), Home/End jump, Enter/Space choose. Text fields keep their own keys. Mouse and touch work on the same buttons. The pause and settings windows get this too. The ▶ cursor now shows on any focus, including focus set when a window opens.
  - **Typewriter dialogue:** NPC lines type out at about 55 characters a second, with short beats after punctuation (`visibleChars`/`durationOf` are pure and tested). The first key or click finishes the text instead of choosing an option. With reduced motion it's instant. Screen readers get the whole text at once (the animated copy is `aria-hidden`).
  - **Forms:** real `<label>`/`<input>`/`<select>`, hints and errors tied in with `aria-describedby`, `aria-invalid`, focus moved to the first problem, a form-level `role="alert"` message, a Show/Hide toggle for passwords, a busy state that blocks double submits, and a `money` field type (decimal keypad) for Phase 5. The shared Zod schemas check first; then the server's answer is authoritative. Its field errors show inline and other errors (bad credentials, lockout, rate limit, offline) at the top, and the form stays open to try again.
  - **Tables and details** use tabular numbers and right-aligned amounts. `movementCell` always signs amounts (+/−) and `balanceCell` flags negatives, each with a spoken label, so color is never the only cue. Result windows show an icon and a word (Done / Problem / Note); errors use `role="alertdialog"`. The demo disclaimer appears on the login and signup forms as a highlighted notice.
  - **Check-In desk (Pip):** Check in → login form → the session is applied → the gate opens → Pip confirms. "I forgot my password" explains that a real bank would email a reset link and points demo users to the README. When you're already checked in: "Thanks!" or "Check me out", which goes through a confirm window.
  - **New Accounts desk (Juniper):** "What do I get?" explains the accounts; "Open my accounts" opens the signup form (name, email, password with rules hint, confirmation). After signup, a table window lists the new accounts (checking with the $1,000.00 bonus, savings at $0.00) straight from `GET /accounts`, then you're signed in with the gate open.
  - `ApiClient` gained `signup()` and `getAccounts()`. The old `ui/dialogue.ts` is replaced by `Windows.dialogue`.
  - **Not in this phase:** UI sounds (Phase 8 polish). The 2FA prompt at check-in waits for 2FA setup at the Security Center (Phase 5) and the `/auth/2fa` endpoints, which aren't built yet.
  - **Checked in the browser:** the typewriter mid-line with the full text available to screen readers; arrow keys wrap through Pip's options; an empty submit shows both field errors and focuses Email; a wrong demo password shows the server's generic message with the form still open; the right password signs in and opens the gate; "Check me out" shows the confirm window, and Backspace backs out still signed in; a fresh signup (a throwaway `tester-…@bramblewood.test` account, now in the local dev database; `npm run db:reset` clears it) shows the mismatched-confirmation error, then the new-accounts table, the HUD name and the open gate.
