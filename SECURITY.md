# Security

This document describes how **My Situation Room** is hardened, and the few steps only you (the operator) can do. Report a vulnerability privately to the maintainer — do not open a public issue.

## What the application already enforces

**Authentication & sessions**
- Login tokens are signed JWTs in the `Authorization: Bearer` header — **no cookies**, so cross-site request forgery (CSRF) is not a usable attack surface.
- `JWT_SECRET` must be long and random. If it is set to a short or placeholder value the server **refuses to start in production** (and warns in dev). Leave it unset to auto-generate and persist a 48-byte secret (`DATA_DIR/.jwt_secret`, mode 600).
- Passwords/passcodes are hashed with **bcrypt**; plaintext is never stored. Two-step login (TOTP) is available for Command operators.
- Observer codes are **device-locked** (first phone + PIN); a reset ends the session on the old device.

**Multi-tenant isolation (defense in depth)**
- **Deliberate exception — pooled vote counts.** Global Collation can add up the vote counts of the Command Centers of one state (aggregates only: no observers, codes, photos, video, audio or positions). The platform administrator controls this per Command Center ("Pool votes"); switch it off for clients whose figures must stay private from each other.
- Every Command Center is isolated at the **database layer** with PostgreSQL **Row-Level Security**. Authenticated queries run as a restricted role with the tenant/room set per request, so one command physically cannot read another's rooms, observers, results, photos, radio or audit — even if an application check were missed.

**Abuse resistance**
- Login endpoints are **rate-limited** per IP and per account (failed attempts only, so many observers behind one mobile-carrier IP are not blocked).
- All SQL uses **bound parameters**; dynamic `WHERE` clauses are built only from server-side role/tenant values, never from user input.
- Uploads are capped and type-checked: EC8A photos are `image/*` only, max 20 MB, stored under server-generated filenames (no path traversal); radio audio is `audio/*` only, max 60 MB, one file.
- EC8A photos carry a **SHA-256** recorded at upload as tamper evidence.

**Browser hardening (HTTP response headers)**
- **Content-Security-Policy**: scripts and styles load only from our own origin, so an injected `<script src="evil">` is blocked. Framing, `<object>`, `<base>` and cross-origin form posts are locked down. External needs are explicitly allow-listed (map tiles, Google Fonts on the pitch page, LiveKit/WebSocket, the Vosk WASM worker).
- **HSTS** (`Strict-Transport-Security`) once served over HTTPS, **X-Frame-Options**, **X-Content-Type-Options: nosniff**, **Referrer-Policy**, **Permissions-Policy**, **Cross-Origin-Opener-Policy**. `X-Powered-By` is disabled and the server banner is stripped at the edge.
- User-supplied text is **HTML-escaped** wherever it is rendered.
- API responses are `Cache-Control: no-store`.

**Supply chain**
- **Dependabot** watches npm (app + mobile), GitHub Actions and the Docker base image weekly.
- CI runs `npm audit --audit-level=high` and **fails** on known high/critical runtime vulnerabilities.
- Workflows use least-privilege `permissions` and pinned, first-party actions.

**Container**
- The server runs as the **unprivileged `node` user** (not root). Built from `node:22-alpine`, `NODE_ENV=production`.

## Your part — do these once

These cannot be set from the code; you (or a GitHub org owner) must enable them.

**GitHub**
1. **Protect `main`**: Settings → Branches → add a rule requiring pull-request review and passing `test` checks; disallow force-push and deletion.
2. Enable **secret scanning** and **push protection**: Settings → Code security.
3. Require **2FA** for everyone with write access (your account Settings → Password and authentication).
4. Keep the "Allow only GitHub-authored and verified actions" policy you already have.

**Secrets & server**
5. Generate real secrets with `sh scripts/gen-secrets.sh`, put them in `.env`, and `chmod 600 .env`. Never commit `.env`.
6. If you ever think a secret leaked, rotate it: new `JWT_SECRET` (logs everyone out), new DB password, new LiveKit/TURN secrets.
7. **Firewall** the server: expose only 80/443 (and the TURN UDP range 49160–49200) to the internet; keep Postgres/Redis/LiveKit on the internal Docker network only (the compose file already does this — do not publish their ports).
8. Harden SSH: key-only login, disable root password login, and run **fail2ban**.
9. Keep automatic **off-site backups** of the database (the app writes `pg_dump` snapshots to `DATA_DIR/backups`; copy them somewhere else too).
10. Keep the host and Docker images updated; merge Dependabot PRs after CI passes.

**TLS**
11. Use a real domain so Caddy issues a valid Let's Encrypt certificate (already working on `mysituationroom.com.ng`). Avoid self-signed certs in the field.

## Adjusting the Content-Security-Policy

If a future feature needs another external origin, extend the policy via the `CSP` env var (whole value) rather than loosening the code. `CSP_OFF=1` disables it entirely (not recommended).
