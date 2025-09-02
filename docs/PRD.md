# PoofPass v1 — Product Requirements Document (PRD)

Version: 1.0
Owner: PoofPass Team
Date: 2025-09-01
Status: Draft

## 1. Overview
PoofPass is a disposable password and session utility designed for secure creation, rotation, and distribution of short-lived credentials. It provides a web application, REST-ish API (Next.js App Router), Supabase Edge Functions (for secrets handling and OTAC sessions), a local bridge service, and a Chrome extension for session handoff via cookie bundles.

Core principles:
- Zero Trust, pointer-based secret architecture
- Defense-in-depth security with strict RLS and key separation (KEK/DEK)
- Rotation-first lifecycle for passwords and “checks”
- Minimal exposure of plaintext secrets

## 2. Problem Statement
Developers and teams need a safe way to issue, use, and rotate temporary credentials (passwords, session cookies, zero-trust “checks”) across systems, browsers, and automation while minimizing secrets exposure and supporting quotas, billing, and observability.

## 3. Goals
- Generate disposable passwords and rotate on use.
- Store secrets encrypted-at-rest in a vault with blinded pointers; reference only in the app DB.
- Support issuing and verifying zero-trust “check credentials.”
- Provide secure session handoff to a browser via a local bridge + Chrome extension.
- Offer 2FA (TOTP) and WebAuthn support, passwordless login via magic link.
- Enforce quotas, plans, and optional pay-per-rotate via credits.
- Provide audit logging, metrics, and rate limiting.

## 4. Non-Goals
- Native mobile apps (v1).
- Full end-to-end, client-side only encryption of vault secrets (edge functions decrypt with KEK; E2E is roadmap).
- Hardware-backed keys/HSM integration (roadmap).
- Advanced post-quantum cryptography (roadmap).

## 5. Target Users & Personas
- Individual developers: need quick, safe, rotated secrets for dev/test/staging.
- Small teams: share disposable credentials with auditability and quotas.
- Enterprise Sec/IT: enforce short-lived credentials and zero-trust checks with usage controls.

## 6. Product Scope & Surfaces
- Web App (Next.js 14, TypeScript, Tailwind, shadcn/ui).
- API (Next.js App Router routes; OpenAPI doc in docs/openapi.yaml).
- Supabase Edge Functions (vault-store, vault-reveal, otac-issue, otac-claim, otac-status).
- Chrome Extension (PoofPass Bridge) + Local Bridge (FastAPI) for cookie bundle handoff.
- Database (Supabase): public + vault schemas with strict RLS; billing/credits/entitlements (Stripe).

## 7. Architecture (High-Level)
- App server (Next.js) handles auth, policies, quotas, API, and orchestrates Supabase Edge Functions.
- Edge Functions perform sensitive crypto operations and database writes/reads on the vault schema using the service role key.
- Vault stores only ciphertext and wrapped DEKs. App DB stores blinded pointers and metadata; never stores plaintext secrets.
- Local Bridge (FastAPI) keeps short-lived cookie bundles in memory and authenticates via a shared local token.
- Chrome Extension fetches bundles from the Local Bridge, validates eTLD+1, and writes cookies.

Key components:
- poofpass-app (web/app/api, supabase, docs)
- poofpass (core utilities, Totp, DSL, Chrome extension, local bridge)
- poofpass-handshake (prototype: quantum-inspired session proofs demo)
- poofpass-landing (static marketing site)

## 8. Functional Requirements

### 8.1 Authentication
- Magic link sign-in endpoint: /api/auth/magic-link
- 2FA (TOTP) setup and enable: /api/auth/2fa/setup, /api/auth/2fa/enable
- WebAuthn flows: /api/webauthn/* (register/authenticate) endpoints
- Middleware enforces security headers, CSRF, and protects key routes.

Acceptance:
- Users can authenticate and access protected routes with Supabase cookies.
- Enabling TOTP produces secret, QR, and backup codes.

### 8.2 Disposable Passwords
- Create password reference: POST /api/passwords (label, expiresAt, metadata optional)
  - Delegates secret generation to supabase functions/v1/vault-store
  - Quotas enforced (free vs pro)
- List password references: GET /api/passwords (filter by label/status)
- Use/Rotate password: PATCH /api/passwords/{id}
  - Marks as used, logs event, triggers rotation via vault-store

Acceptance:
- Creating a password produces a reference row with pointer and current_version.
- Using a password updates status=used and triggers a next version to be created.
- Free plan limits: active references <= 10; rotations <= 10 events (configurable).

Notes:
- Plaintext secrets are not returned here. Retrieval occurs via vault-reveal Edge Function.

### 8.3 Vault (Secrets) & Pointer Blinding
- vault.secrets(pointer, version, ciphertext, dek_wrapped) with RLS denying all operations.
- password_references only stores pointer/reference metadata.
- Pointer derivation: HMAC(pepper, user_id:label) → base64url pointer.
- KEK wraps per-secret DEKs; AES-256-GCM used for secret encryption.

Edge Functions:
- vault-store: generates secret + DEK, encrypts and writes to vault.secrets; upserts reference.
- vault-reveal: decrypts latest (or requested) version for a pointer and returns secret.

Acceptance:
- No direct selects/inserts/updates on vault.secrets by clients.
- vault-store and vault-reveal succeed with proper env keys (SERVICE_ROLE, VAULT_KEK, PEPPER).

### 8.4 Zero-Trust “Check” Credentials
- Issue: POST /api/check/issue
- Verify: POST /api/check/verify (optional rotate)

Acceptance:
- Issued checks contain id/label/secret; verification succeeds with valid secret and can rotate.

### 8.5 OTAC (One-Time Authorization Code) Sessions
- Edge Functions: otac-issue, otac-claim, otac-status
- Issue returns { session_id, code } (short TTL, default ~90s); claim is HMAC(pepper, code) match; idempotent.

Acceptance:
- Issued OTACs expire on time and can be claimed once.

### 8.6 Browser Session Handoff
- Local Bridge (FastAPI) stores CookieBundle(site, issuedAt, expiresAt, cookies[]), auth via shared token file/env.
- Chrome Extension fetches bundle by eTLD+1, validates cookie domain matches eTLD+1 or subdomain, writes cookies, and reloads the tab.

Acceptance:
- With a valid shared token configured, when navigating to etld1.com the extension attempts a bundle fetch and writes cookies.
- Bundles expire and are purged when expired or after being consumed if configured.

### 8.7 Billing & Credits
- Stripe integration: checkout, webhooks, and plan status endpoints.
- Entitlements and credits (RPC: spend_credit) for optional per-rotate charges.

Acceptance:
- Pro plan unlocks higher quotas and optional credit consumption; free plan returns QUOTA_EXCEEDED when over limits.

### 8.8 Observability & Compliance
- Audit events: password_events insertions for created/used/rotated.
- Metrics endpoints and advanced monitoring hooks.
- Security headers in middleware; CSP, CSRF checks, and rate limiting.

Acceptance:
- Metrics route responds with app statistics (internal or public-safe subset).
- Audit and rate-limit behavior observable in logs and DB.

## 9. Data Model (Key Tables)
- vault.secrets(pointer text, version int, ciphertext bytea, dek_wrapped bytea, created_at)
- public.password_references(id uuid, user_id uuid, label text, pointer text unique, current_version int, status text, created_at)
- public.password_events(id, password_id, event, created_at)
- public.otac_sessions(id uuid, user_id uuid, code_hash text, scope jsonb, claimed_at timestamptz, expires_at timestamptz)
- Billing: orgs, entitlements, credits, Stripe checkout and webhook records

RLS:
- vault.secrets: deny all (service role only).
- password_references: owner-only select/insert/update.
- otac_sessions: owner-only select/insert/update.

## 10. Security & Privacy
- Encryption at rest: AES-256-GCM; DEK wrapped with KEK (env); pointer blinding via HMAC(pepper).
- In transit: TLS 1.3 expected; HSTS, CSP, strict headers in middleware.
- AuthZ: RLS + RBAC patterns; admin endpoints gated.
- 2FA: TOTP; WebAuthn supported.
- Rate limiting per route; blacklist on repeated abuse.
- Secrets never stored in app DB or logs; no plaintext in password_references.
- Local Bridge auth via shared token; restrict CORS in production and lock down extension IDs.

Risks/Mitigations:
- Edge function returns plaintext secret: mitigate with short TTL retrieval, server-side only usage, and roadmap to E2E client encryption.
- Extension wide host permissions: restrict to target domains and production bridge URL; document security tradeoffs.
- Local Bridge token exposure: store in 0600 file, rotate; restrict origins; production tighten CORS.

## 11. User Experience (Key Flows)
- Onboarding: Magic link → set up 2FA (QR/backup codes) → dashboard.
- Create password: dashboard form → POST /api/passwords → success toast, row appears.
- Use password: client triggers PATCH /api/passwords/{id} after consumption → rotates to next version.
- Reveal secret (when needed): backend/edge-call via vault-reveal using pointer/current_version.
- OTAC flow: issue → present QR or code → claim from a second device/process → status poll.
- Browser handoff: local tool delivers CookieBundle to Local Bridge → extension writes cookies on eTLD+1 navigation.

## 12. API (Selected)
- OpenAPI: docs/openapi.yaml (health, passwords list/create/use, check issue/verify, auth 2FA setup/enable, magic-link)
- Protected routes via middleware with CSRF and headers; public exceptions for health, magic-link, webhooks.

## 13. Performance & Reliability
- Caching: Redis-backed cache for hot lists, short TTLs with tag invalidation.
- Rate limits: Free 20 rpm, Pro 40 rpm, Enterprise 200 rpm (configurable).
- Robust error handling and consistent ApiResponse envelope.
- Idempotency: otac-claim and parts of rotation flows are idempotent/defended.

## 14. Billing & Pricing
- Free: up to 10 active references; 10 rotations; basic analytics.
- Pro: higher limits; priority; optional credits for pay-per-rotate.
- Enterprise: custom limits and SSO/SAML (future).

## 15. Telemetry & Analytics
- PostHog for product analytics (sanitized).
- Sentry for error monitoring.
- Metrics route for ops; advanced-metrics library hooks.

## 16. Rollout Plan
- Dev: local .env.local, Supabase project, apply migrations, run npm dev.
- Staging: provision managed Supabase; configure Stripe test keys; seed plans; verify OTAC and vault functions.
- Production: rotate keys; restrict CORS/extension IDs; finalize Stripe products; enable WAF rules; add backups.
- Chrome Extension: publish with least privileges; version pin; review.

## 17. Acceptance Criteria (Summary)
- Auth + 2FA/WebAuthn working; protected routes enforced.
- Passwords list/create/use flows pass unit/integration tests.
- Vault-store/reveal functional with KEK/pepper; vault RLS denies non-service access.
- OTAC sessions issue/claim/status meet TTL and idempotency behavior.
- Chrome Extension writes cookies only to eTLD+1 or subdomains; respects secure/httpOnly flags.
- Rate limiting enforced; quotas respected; audit events logged.
- Stripe checkout/webhook roundtrip updates entitlements; credits consumed on rotate when configured.

## 18. Risks & Open Questions
- E2E encryption for vault reveal: scope and design for v1.1.
- Browser extension permissions tightening and token management UX.
- Team sharing model details (scopes, shared labels, access controls) beyond initial feature stubs.
- Enterprise SSO/SAML requirements and deployment model.

## 19. Roadmap (Post v1)
- Client-side E2E encryption envelopes for reveals.
- HSM or cloud KMS for KEK.
- Passkey-first auth and recovery flows.
- Mobile companion apps; certificate pinning.
- Advanced anomaly detection and adaptive risk scoring.
- Formalized site automation using DSL with headless runners.

## 20. Dependencies
- Next.js 14, React 18, Tailwind, shadcn/ui
- Supabase (Auth, DB, Edge Functions), Redis (optional caching)
- Stripe, Sentry, PostHog
- Chrome (min v114) for extension; Python 3.x for Local Bridge (FastAPI)

## 21. Environment & Setup
See docs/ENVIRONMENT_SETUP.md for variables (Supabase URL/keys, KEK, pointer pepper, OTAC pepper, Stripe keys, Sentry, PostHog, site URL).

## 22. References
- docs/openapi.yaml
- docs/SECURITY.md
- supabase/functions/* (vault-store, vault-reveal, otac-issue, otac-claim, otac-status)
- app/api/* (passwords, check, auth, billing, credits, metrics)
- poofpass/bridge (FastAPI local bridge)
- poofpass/extension-chrome (Chrome extension)
