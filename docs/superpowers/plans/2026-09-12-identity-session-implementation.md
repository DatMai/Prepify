# Prepify Identity and Session Implementation Plan

> **Execution rule:** Follow Superpowers TDD task by task. Every behavior change starts with a failing test, then the smallest implementation, then verification and a focused commit. Do not push.

**Goal:** Replace browser-stored bearer JWT authentication and security-question recovery with opaque server-side sessions, safe password recovery, explicit authorization, and protected OAuth callbacks.

**Architecture:** PostgreSQL owns identity and session state. The browser receives only an opaque session cookie; every protected request resolves the current user from the database. Unsafe requests must come from an allowed origin. Authentication routes are built through factories so repositories, mail delivery, clocks, hashing, and random-token generation are testable without a live server.

**Tech stack:** Express 5, PostgreSQL, Passport OAuth, Zod, bcrypt, Vitest, Supertest, TypeScript.

---

## Task 1: Add append-only session and OAuth-flow storage

**Files:**

- Create: `server/migrations/008_add_sessions_and_oauth_flows.sql`
- Create: `server/src/modules/identity/sessionRepository.ts`
- Create: `server/src/modules/identity/sessionRepository.test.ts`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.test.ts`
- Modify: `server/.env.example`

- [x] **Step 1: Write failing repository and config tests**

Cover:

- raw session tokens are never persisted;
- session lookup returns a current user only for an unexpired, non-revoked row;
- password reset can revoke all active sessions;
- OAuth flow state is one-time and expires;
- cookie configuration is secure in production and usable on localhost;
- session TTL is bounded and validated.

- [x] **Step 2: Confirm RED**

Run the new tests and confirm failure is caused by missing session storage/config, not test setup.

- [x] **Step 3: Add migration 008**

Create append-only schema changes:

- `sessions(id, user_id, token_hash, expires_at, last_seen_at, revoked_at, created_at)`;
- unique index on `token_hash` and lookup indexes on active user sessions;
- `oauth_flows(state_hash, provider, code_verifier, return_path, expires_at, used_at, created_at)`;
- drop the obsolete `security_question` and `security_answer_hash` columns only in this new migration;
- delete no historical migration.

- [x] **Step 4: Implement the repository**

Use SHA-256 for opaque token/state lookup, cryptographically random raw values, parameterized SQL, constant external error semantics, explicit clock/random dependencies in tests, and one-time OAuth flow consumption in a transaction-safe statement.

- [x] **Step 5: Verify and commit**

Run server tests, typecheck, migration compilation, and commit:

```text
feat: thêm kho session phía server
```

---

## Task 2: Replace bearer middleware with cookie authentication and CSRF defense

**Files:**

- Create: `server/src/modules/identity/sessionCookie.ts`
- Create: `server/src/modules/identity/sessionAuth.ts`
- Create: `server/src/modules/identity/sessionAuth.test.ts`
- Create: `server/src/middleware/trustedOrigin.ts`
- Create: `server/src/middleware/trustedOrigin.test.ts`
- Modify: `server/src/middleware/auth.ts`
- Modify: `server/src/middleware/admin.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`

- [x] **Step 1: Write failing middleware tests**

Prove:

- missing, malformed, expired, and revoked cookies produce the same 401 envelope;
- a valid cookie attaches `userId`, email, and role from the current DB row;
- admin checks use the resolved role and do not run a second query;
- unsafe requests without a trusted `Origin` are rejected;
- trusted configured origins pass; safe methods remain usable;
- cookie parse/clear options match in development and production.

- [x] **Step 2: Confirm RED**

- [x] **Step 3: Implement session-cookie middleware**

Use `HttpOnly`, `SameSite=Lax`, `Path=/`; add `Secure` and the `__Host-` prefix in production. Do not accept bearer JWT as a fallback.

- [x] **Step 4: Add origin enforcement**

Run the trusted-origin middleware before state-changing routes. Reject missing or non-allowlisted browser origins while permitting health checks and safe methods. CORS remains an independent browser policy.

- [x] **Step 5: Verify and commit**

```text
refactor: xác thực request bằng session cookie
```

---

## Task 3: Rebuild local identity routes as a dependency-injected module

**Files:**

- Create: `server/src/modules/identity/types.ts`
- Create: `server/src/modules/identity/userRepository.ts`
- Create: `server/src/modules/identity/authService.ts`
- Create: `server/src/modules/identity/authRoutes.ts`
- Create: `server/src/modules/identity/authRoutes.test.ts`
- Modify: `server/src/index.ts`
- Delete: `server/src/routes/auth.ts`

- [ ] **Step 1: Write failing route tests**

Cover register, login, current session, logout, validation, duplicate email, OAuth-only account, invalid credentials, session rotation, and generic public errors. Assert responses never contain `token` and cookies are HttpOnly.

- [ ] **Step 2: Confirm RED**

- [ ] **Step 3: Implement schemas and service**

Normalize email once, validate all inputs with Zod, hash passwords with the existing strength policy, create a fresh session after register/login, revoke the current session on logout, and return a single public user shape.

- [ ] **Step 4: Add endpoint limits**

Use strict rate limits for login/register/reset requests. Return stable error codes without exposing account existence beyond the unavoidable authenticated flows.

- [ ] **Step 5: Wire the module at the composition root**

The composition root supplies config, pool/repositories, mailer, logger and clocks. Route modules must not read `process.env` directly.

- [ ] **Step 6: Verify and commit**

```text
refactor: dựng lại module identity
```

---

## Task 4: Remove security questions and harden password/email tokens

**Files:**

- Create: `server/src/modules/identity/recoveryRoutes.ts`
- Create: `server/src/modules/identity/recoveryRoutes.test.ts`
- Modify: `server/src/index.ts`
- Delete: `server/src/routes/forgotPassword.ts`
- Modify: `src/api/client.ts`
- Modify: `src/ui/authModal.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/vi.ts`

- [ ] **Step 1: Write failing recovery tests**

Assert forgot-password always gives the same 200 response, never returns a reset token, stores only a token hash, enforces expiry/one-time use, and revokes all sessions after password change. Email verification tokens remain hashed and one-time.

- [ ] **Step 2: Confirm RED**

- [ ] **Step 3: Implement recovery routes**

Keep reset tokens in HTTPS links only, make responses enumeration-resistant, and run password update + token consumption + session revocation atomically.

- [ ] **Step 4: Delete the question-based UI/API**

Remove question strings, fields, modes, handlers and endpoints. Registration asks only for identity fields. Keep concise bilingual copy.

- [ ] **Step 5: Verify and commit**

```text
refactor: loại bỏ câu hỏi bảo mật
```

---

## Task 5: Secure OAuth and prevent implicit account linking

**Files:**

- Create: `server/src/modules/identity/oauthFlowStore.ts`
- Create: `server/src/modules/identity/oauthAccountService.ts`
- Create: `server/src/modules/identity/oauthRoutes.ts`
- Create: `server/src/modules/identity/oauthAccountService.test.ts`
- Create: `server/src/modules/identity/oauthFlowStore.test.ts`
- Modify: `server/src/index.ts`
- Delete: `server/src/routes/oauth.ts`

- [ ] **Step 1: Write failing OAuth tests**

Prove one-time state, PKCE verifier round-trip, expiry, provider identity lookup, new-provider account creation, and refusal to auto-link an existing local account merely because email text matches.

- [ ] **Step 2: Confirm RED**

- [ ] **Step 3: Implement DB-backed Passport state/PKCE store**

Use the `oauth_flows` table, hash state handles, consume once, and never place access tokens or Prepify session tokens in the redirect URL.

- [ ] **Step 4: Implement safe account resolution**

Existing `(provider, provider_id)` signs in. A new provider identity can create a new user when its email is not in use. Email collision returns a link-required failure; linking must be an explicit authenticated feature later.

- [ ] **Step 5: Establish the opaque session in callback**

Set the session cookie and redirect with only a non-sensitive status code. Preserve provider-not-configured behavior.

- [ ] **Step 6: Verify and commit**

```text
refactor: bảo vệ luồng oauth
```

---

## Task 6: Move the frontend fully to cookie sessions

**Files:**

- Create: `src/state/auth.test.ts`
- Create: `src/api/client.test.ts`
- Modify: `src/state/auth.ts`
- Modify: `src/api/client.ts`
- Modify: `src/api/streak.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/authModal.ts`
- Modify: `src/ui/profileModal.ts`

- [ ] **Step 1: Write failing browser-state and API tests**

Assert no auth token is read/written in localStorage, every API request uses `credentials: include`, login/register restore the server session, 401 clears only in-memory identity, logout calls the server, and OAuth callbacks contain no token adoption path.

- [ ] **Step 2: Confirm RED**

- [ ] **Step 3: Implement cookie-session state**

`AuthState` contains only the user/loading state. Startup calls `GET /auth/session`; login/register response returns the user; logout revokes server state before clearing UI state.

- [ ] **Step 4: Consolidate the second fetch client**

Move streak/daily calls through the central request client so cookie, timeout, errors and future CSRF policy cannot diverge.

- [ ] **Step 5: Delete all token adoption/storage paths**

Repository search for `JWT_SECRET`, `jsonwebtoken`, `auth_token`, `quiz:token`, `Authorization: Bearer`, security-question APIs and UI must return no runtime matches.

- [ ] **Step 6: Verify and commit**

```text
refactor: dùng cookie session trên frontend
```

---

## Identity Completion Checkpoint

- [ ] Run `npm run check`.
- [ ] Run production audits and record zero unexplained high/critical findings.
- [ ] Run `git diff --check` and a secret scan.
- [ ] Confirm no real corpus is tracked or emitted in `dist/`.
- [ ] Confirm no auth token is present in query strings, JSON auth responses, browser storage or logs.
- [ ] Confirm migrations are append-only and migration 008 is idempotent.
- [ ] Confirm no push occurred.

Expected outcome: password and supported OAuth login create revocable opaque sessions; authorization reads current server state; password recovery is one-time and enumeration-resistant; unsafe browser writes are origin-protected; the frontend stores no credential.
