# Icestock Arena — Icestock Sport Tournament & Live Scoring Platform

A full-stack web platform for organizing and scoring **Icestock Sport**
tournaments at International, National, State, and District level, built
around the six official disciplines requested:

1. Team Game
2. Team Target
3. Team Distance
4. Individual Target
5. Individual Distance
6. Head to Head

Scoring logic is modeled on the **International Federation Icestocksport
(IFI)** publicly documented rules (icestock.sport/en/disciplines,
icestock.sport/en/ifi/rules). Every numeric rule (rings, rounds, zone
points, game-point thresholds) lives in one config object
(`backend/src/services/scoringEngine.js`) so you can tune it against the
current official IFI rulebook PDF without touching the rest of the code.

---

## 1. What's included

| Layer | Stack |
|---|---|
| Backend API | Node.js, Express, PostgreSQL, Socket.io (live scoring), JWT auth |
| Frontend | React 18 + Vite, React Router, Socket.io client |
| PDF scorecards | pdfkit, generated server-side, tamper-evident (SHA-256 hash) |
| Security | helmet CSP, rate limiting, bcrypt, RBAC, audit log, input validation, XSS sanitization |
| Deployment | Docker + docker-compose, GitHub Actions CI |

### Role system

| Role | Scope | Capabilities |
|---|---|---|
| **SUPER_ADMIN** | Everything | The single account with full platform access. Creates all Head and Referee logins, manages countries/states/districts, oversees every tournament. |
| **COUNTRY_HEAD** | One country | Registers teams & players within their country; creates tournaments at national level. ("National Head" in most federations *is* the country's head — see note below.) |
| **STATE_HEAD** | One state | Registers teams & players within their state. |
| **DISTRICT_HEAD** | One district | Registers teams & players within their district. |
| **REFEREE** | Assigned matches only | Starts matches, submits live scores per the event's rules, finalizes results, generates official scorecard PDFs. |
| **PLAYER** | Own profile | Read-only stats, practice mode, subscription-gated advanced analytics. |

> **Note on "National Head":** your brief lists Country, National, State,
> and District heads as four tiers. Internationally, a country's national
> federation head *is* the country head — so this build maps "National
> Head" onto `COUNTRY_HEAD`. If your organization genuinely needs a
> continental/National tier sitting between International and Country
> (e.g. a regional body spanning several countries), it's a small schema
> addition — add a `national_id` column following the exact pattern used
> for `country_id`/`state_id`/`district_id` throughout the codebase.

---

## 2. Project structure

```
icestock-platform/
├── backend/
│   ├── src/
│   │   ├── config/db.js              # PostgreSQL pool, parameterized queries only
│   │   ├── db/schema.sql             # Full schema (run once via `npm run migrate`)
│   │   ├── db/migrate.js             # Applies schema.sql
│   │   ├── db/seed.js                # Creates the SUPER_ADMIN account
│   │   ├── middleware/                # auth, rbac, security (helmet/rate-limit), errors
│   │   ├── routes/                    # auth, users, geo, teams, players, tournaments,
│   │   │                               scoring, scorecards, stats, subscriptions
│   │   ├── services/scoringEngine.js  # The 6 event types' point systems
│   │   ├── services/pdfService.js     # Scorecard PDF rendering
│   │   └── server.js                  # Express + Socket.io entry point
│   ├── package.json / .env.example / Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/admin/…              # Super Admin dashboards
│   │   ├── pages/referee/…            # Referee match list + live scoring UI
│   │   ├── pages/player/…             # Player stats + practice mode
│   │   ├── pages/RegistrationPage.jsx # Country/State/District Head registration
│   │   ├── pages/TournamentsPage.jsx  # Create tournaments across all 6 events
│   │   ├── components/, context/, api/, styles/
│   ├── package.json / .env.example / Dockerfile / nginx.conf
├── docker-compose.yml
├── .github/workflows/ci.yml
└── README.md  ← you are here
```

---

## 3. Local setup (no Docker)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ running locally (or a hosted instance)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT secrets (openssl rand -base64 64),
# and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD for the first login.
npm install
npm run migrate     # applies schema.sql
npm run seed        # creates the SUPER_ADMIN account + sample countries
npm run dev          # http://localhost:5000
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

Log in at `http://localhost:5173/login` with the `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` you set in `backend/.env`. **You will be forced to
change the password on first login** — this is intentional.

---

## 4. Local setup with Docker

```bash
cp backend/.env.example backend/.env    # edit secrets first
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:5000
- Postgres: localhost:5432

Then run migration + seed once, inside the running backend container:

```bash
docker compose exec backend npm run migrate
docker compose exec backend npm run seed
```

---

## 5. Admin login (initial credentials)

The **first SUPER_ADMIN account** is created by the seed script from your
own `.env` values — nothing is hardcoded in the codebase:

```
Email:    whatever you set as SEED_ADMIN_EMAIL
Password: whatever you set as SEED_ADMIN_PASSWORD
```

The example values in `.env.example` are placeholders
(`admin@icestock.local` / `CHANGE_ME_STRONG_PASSWORD_123!`) — **you must
replace them with your own before running `npm run seed`.** The account is
flagged `must_change_password = true`, so the very first login forces a
password reset before anything else is accessible. From that account you
create every Country/State/District Head and Referee login through
**Manage Logins** in the admin dashboard.

---

## 6. Deploying to GitHub + hosting

### Step 1 — Push to GitHub

```bash
cd icestock-platform
git init
git add .
git commit -m "Initial commit: Icestock Arena platform"
git branch -M main
git remote add origin https://github.com/<your-username>/icestock-arena.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules/`, `storage/`, and
`logs/` — double-check `git status` before your first commit that no
secrets are staged.

### Step 2 — Set up branch protection & secrets (recommended)

In your GitHub repo settings:
- **Settings → Branches**: require PR review before merging to `main`.
- **Settings → Secrets and variables → Actions**: add any deployment
  secrets your hosting provider needs (see below). The included
  `.github/workflows/ci.yml` runs lint + `npm audit` + a frontend build on
  every push/PR automatically.
- Enable **Dependabot** (Settings → Code security) so dependency
  vulnerabilities surface automatically — this matters for a
  security-sensitive sports-scoring platform.

### Step 3 — Deploy the backend

Any Node-friendly host works. Two straightforward options:

**Render / Railway (simplest)**
1. Create a new Web Service from your GitHub repo, root directory `backend`.
2. Build command: `npm install`. Start command: `node src/server.js`.
3. Add a managed PostgreSQL instance; copy its connection string into
   `DATABASE_URL`.
4. Set all other `.env.example` variables as environment variables in the
   dashboard (never commit `.env`).
5. After first deploy, run `npm run migrate` and `npm run seed` via the
   provider's one-off/shell command feature.

**Docker on any VPS**
1. `docker compose up -d --build` on the server.
2. Put a reverse proxy (nginx/Caddy) in front with a real TLS certificate
   (Let's Encrypt) — the app assumes HTTPS in production (`trust proxy`,
   secure cookies if you add them).

### Step 4 — Deploy the frontend

**Vercel / Netlify**
1. Import the repo, set root directory to `frontend`.
2. Build command: `npm run build`, output directory: `dist`.
3. Set `VITE_API_URL` and `VITE_SOCKET_URL` to your deployed backend's URL.

Or serve the `frontend/Dockerfile` (nginx) alongside the backend via
`docker-compose.yml` on the same VPS.

### Step 5 — Point CORS at your real domain

In the backend `.env`, set `CLIENT_URL` to your deployed frontend origin
(comma-separate multiple origins if needed) — the server only accepts
requests from origins listed here.

---

## 7. Security measures already built in

- **Password storage**: bcrypt, cost factor 12 (configurable).
- **JWT**: short-lived (15 min) access tokens + rotating, server-tracked
  refresh tokens (hashed at rest, revocable, 7-day expiry).
- **Account lockout**: 6 failed logins locks the account for 15 minutes.
- **RBAC**: every route enforces role + geographic scope server-side —
  the frontend hiding a button is never the only protection.
- **SQL injection**: 100% parameterized queries (`pg` with `$1, $2…`),
  never string concatenation.
- **XSS**: request bodies sanitized; strict CSP via helmet blocks inline
  scripts.
- **Rate limiting**: general API limiter + a stricter limiter on
  `/api/auth/login` to blunt credential stuffing.
- **HPP protection**: guards against HTTP parameter pollution.
- **Audit log**: every login, account change, registration, and match
  finalization is recorded with actor, IP, and timestamp
  (`audit_logs` table).
- **Tamper-evident scorecards**: each PDF's result is hashed (SHA-256) and
  stored alongside it; results are only ever written by the scoring
  engine after finalization, never hand-typed.
- **CI hygiene**: GitHub Actions runs lint and `npm audit` on every push;
  turn on Dependabot for ongoing dependency patching.

**Before a real sanctioned event**, also do: a professional penetration
test, move file storage to S3/object storage with signed URLs (a stub is
already in `.env.example`), put the API behind a WAF, and add 2FA for
SUPER_ADMIN and REFEREE accounts.

---

## 8. Where the six events' rules live — and what you should double-check

`backend/src/services/scoringEngine.js` documents each event with a
`DEFAULT_CONFIG` object and cites the IFI pages it's based on. Two things
worth verifying against the latest official IFI rulebook
(`https://www.icestock.sport/en/ifi/rules/`) before a sanctioned event:

- **Team Target / Individual Target, rounds 2–4**: the scenario points
  (10/5/2/0) are documented on the IFI site for the general case; confirm
  the exact scenario labels your referees will use match your event's
  local rule sheet.
- **Distance zone bands**: the official rulebook's exact meter-to-point
  bands weren't fully extractable from the public site at time of
  writing — the zones in `DEFAULT_CONFIG.TEAM_DISTANCE`/
  `INDIVIDUAL_DISTANCE` are placeholders you should replace with the
  current rulebook's numbers (or your organization's own distance-event
  scoring table) via each tournament's `format_config` before going live.

Because these are stored per-tournament in `tournament_events.format_config`
(JSON), an admin can update them from the rulebook at any time without a
code deployment.

---

## 9. Extending this further

This is a complete, working foundation — auth, roles, the full data model,
real-time scoring, PDF generation, and deployment are all functional
end-to-end. Natural next additions as you grow:

- Bracket/fixture auto-generation for knockout Head-to-Head rounds.
- A public spectator view (read-only live scoreboard, no login).
- Payment provider integration for the subscription tiers (Stripe/Razorpay
  webhook instead of the current self-reported `POST /subscriptions`).
- Email delivery for temp passwords instead of returning them in the API
  response.
- Photo/logo uploads (S3) for teams and player profiles.
- A mobile-friendly PWA wrapper for referees scoring rink-side.

---

## 10. License & attribution

Build this out as your own product. Rules are referenced from the public
International Federation Icestocksport (IFI) website for accuracy —
verify against the current official rulebook before any sanctioned
competition, as governing bodies periodically update formats (e.g. IFI's
2025 introduction of the head-to-head target format).
