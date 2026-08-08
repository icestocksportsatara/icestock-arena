-- ============================================================================
-- ICESTOCK SPORT PLATFORM — DATABASE SCHEMA (PostgreSQL 14+)
-- ============================================================================
-- Hierarchy: International (Admin) -> Country -> State/Province -> District
-- Roles: SUPER_ADMIN, COUNTRY_HEAD, STATE_HEAD, DISTRICT_HEAD, REFEREE, PLAYER
-- Note: "National Head" in the brief maps to COUNTRY_HEAD (a country's
-- national federation head). If you need National to be a distinct tier
-- ABOVE Country (e.g. a continental body), add a `national_id` column
-- following the same pattern as country/state/district below.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- GEOGRAPHIC / FEDERATION HIERARCHY
-- ---------------------------------------------------------------------------
CREATE TABLE countries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL UNIQUE,
    iso_code CHAR(3) NOT NULL UNIQUE,
    federation_name VARCHAR(200),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (country_id, name)
);

CREATE TABLE districts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (state_id, name)
);

-- ---------------------------------------------------------------------------
-- USERS & ROLES
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN',
    'COUNTRY_HEAD',
    'STATE_HEAD',
    'DISTRICT_HEAD',
    'REFEREE',
    'PLAYER'
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(180) NOT NULL UNIQUE,
    phone VARCHAR(30),
    password_hash TEXT NOT NULL,
    role user_role NOT NULL,

    -- Scope of authority (only the relevant one is set per role)
    country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
    state_id UUID REFERENCES states(id) ON DELETE SET NULL,
    district_id UUID REFERENCES districts(id) ON DELETE SET NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_country ON users(country_id);
CREATE INDEX idx_users_state ON users(state_id);
CREATE INDEX idx_users_district ON users(district_id);

-- Refresh tokens stored server-side (hashed) so they can be revoked
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------------
-- TEAMS & PLAYERS
-- ---------------------------------------------------------------------------
CREATE TYPE team_level AS ENUM ('INTERNATIONAL','NATIONAL','STATE','DISTRICT');
CREATE TYPE category_type AS ENUM ('MEN','WOMEN','MIXED','YOUTH_BOYS','YOUTH_GIRLS');

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    level team_level NOT NULL,
    category category_type NOT NULL DEFAULT 'MIXED',
    country_id UUID REFERENCES countries(id),
    state_id UUID REFERENCES states(id),
    district_id UUID REFERENCES districts(id),
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    registered_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_teams_district ON teams(district_id);
CREATE INDEX idx_teams_state ON teams(state_id);
CREATE INDEX idx_teams_country ON teams(country_id);

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL, -- nullable: player may not have a login yet
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    jersey_number SMALLINT,
    photo_url TEXT,
    licence_number VARCHAR(60) UNIQUE,
    country_id UUID REFERENCES countries(id),
    state_id UUID REFERENCES states(id),
    district_id UUID REFERENCES districts(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    registered_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_players_team ON players(team_id);

-- ---------------------------------------------------------------------------
-- TOURNAMENTS & EVENTS
-- ---------------------------------------------------------------------------
CREATE TYPE tournament_level AS ENUM ('INTERNATIONAL','NATIONAL','STATE','DISTRICT');
CREATE TYPE tournament_status AS ENUM ('DRAFT','REGISTRATION_OPEN','ONGOING','COMPLETED','CANCELLED');

CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    level tournament_level NOT NULL,
    country_id UUID REFERENCES countries(id),
    state_id UUID REFERENCES states(id),
    district_id UUID REFERENCES districts(id),
    venue VARCHAR(200),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status tournament_status NOT NULL DEFAULT 'DRAFT',
    rules_reference TEXT DEFAULT 'International Federation Icestocksport (IFI) Official Rules',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The 6 official event types requested
CREATE TYPE event_type AS ENUM (
    'TEAM_GAME',
    'TEAM_TARGET',
    'TEAM_DISTANCE',
    'INDIVIDUAL_TARGET',
    'INDIVIDUAL_DISTANCE',
    'HEAD_TO_HEAD'
);

-- format_config holds event-specific, admin-tunable rule parameters
-- (round counts, points-per-ring, qualifying cutoffs, distance zone bands)
-- so numbers can be kept in sync with the latest official IFI rulebook
-- without a code change. Defaults are seeded in seed.js.
CREATE TABLE tournament_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    event_type event_type NOT NULL,
    category category_type NOT NULL DEFAULT 'MIXED',
    format_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, event_type, category)
);

-- ---------------------------------------------------------------------------
-- MATCHES
-- ---------------------------------------------------------------------------
CREATE TYPE match_status AS ENUM ('SCHEDULED','LIVE','PAUSED','COMPLETED','ABANDONED');

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_event_id UUID NOT NULL REFERENCES tournament_events(id) ON DELETE CASCADE,
    round_name VARCHAR(60), -- e.g. "Round of 16", "Final", "Round 1"
    -- Team-based events
    team_a_id UUID REFERENCES teams(id),
    team_b_id UUID REFERENCES teams(id),
    -- Individual-based events
    player_a_id UUID REFERENCES players(id),
    player_b_id UUID REFERENCES players(id),

    referee_id UUID REFERENCES users(id),
    venue_lane VARCHAR(40),
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status match_status NOT NULL DEFAULT 'SCHEDULED',

    -- Final computed results (written by scoring engine, never hand-typed)
    result JSONB, -- { winner, totals, breakdown }

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_matches_event ON matches(tournament_event_id);
CREATE INDEX idx_matches_referee ON matches(referee_id);
CREATE INDEX idx_matches_status ON matches(status);

-- ---------------------------------------------------------------------------
-- EVENT-SPECIFIC SCORING TABLES (raw, append-only entries by referee)
-- ---------------------------------------------------------------------------

-- 1) TEAM_GAME — 6 "turns" (Kehren), each turn each side scores 0-4 icestock
--    points; side with more points across 6 turns gets 2 game points.
CREATE TABLE team_game_turns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    turn_number SMALLINT NOT NULL CHECK (turn_number BETWEEN 1 AND 12),
    team_a_points SMALLINT NOT NULL CHECK (team_a_points BETWEEN 0 AND 4),
    team_b_points SMALLINT NOT NULL CHECK (team_b_points BETWEEN 0 AND 4),
    recorded_by UUID NOT NULL REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, turn_number)
);

-- 2) TEAM_TARGET / INDIVIDUAL_TARGET — 4 rounds x 6 attempts.
--    Round 1: ring score (2/4/6/8/10). Rounds 2-4: scenario score
--    (own stock stays in zone / opponent displaced, etc.) per format_config.
CREATE TABLE target_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    participant_team_id UUID REFERENCES teams(id),
    participant_player_id UUID REFERENCES players(id),
    round_number SMALLINT NOT NULL CHECK (round_number BETWEEN 1 AND 4),
    attempt_number SMALLINT NOT NULL CHECK (attempt_number BETWEEN 1 AND 6),
    points_scored SMALLINT NOT NULL CHECK (points_scored >= 0),
    scenario_code VARCHAR(30), -- for rounds 2-4, which scenario/ring applied
    recorded_by UUID NOT NULL REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, participant_team_id, participant_player_id, round_number, attempt_number)
);

-- 3) TEAM_DISTANCE / INDIVIDUAL_DISTANCE — attempts measured in meters,
--    converted to zone points per format_config.distanceZones
CREATE TABLE distance_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    participant_team_id UUID REFERENCES teams(id),
    participant_player_id UUID REFERENCES players(id),
    attempt_number SMALLINT NOT NULL,
    distance_m NUMERIC(6,2) NOT NULL CHECK (distance_m >= 0),
    zone_points SMALLINT NOT NULL DEFAULT 0,
    is_fault BOOLEAN NOT NULL DEFAULT FALSE, -- e.g. left the funnel lane
    recorded_by UUID NOT NULL REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) HEAD_TO_HEAD — knockout duel, rounds of 4 alternating attempts,
--    round points awarded each round, first to 7 game points wins.
CREATE TABLE head_to_head_rounds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_number SMALLINT NOT NULL,
    player_a_round_points SMALLINT NOT NULL DEFAULT 0,
    player_b_round_points SMALLINT NOT NULL DEFAULT 0,
    player_a_raw_score SMALLINT NOT NULL DEFAULT 0,
    player_b_raw_score SMALLINT NOT NULL DEFAULT 0,
    recorded_by UUID NOT NULL REFERENCES users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, round_number)
);

-- ---------------------------------------------------------------------------
-- SCORECARDS (generated PDFs)
-- ---------------------------------------------------------------------------
CREATE TABLE scorecards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_hash VARCHAR(128) NOT NULL, -- SHA-256, for tamper-evidence
    generated_by UUID NOT NULL REFERENCES users(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS (players) & PRACTICE MODE
-- ---------------------------------------------------------------------------
CREATE TYPE subscription_plan AS ENUM ('FREE','PRO','ELITE');
CREATE TYPE subscription_status AS ENUM ('ACTIVE','EXPIRED','CANCELLED');

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    plan subscription_plan NOT NULL DEFAULT 'FREE',
    status subscription_status NOT NULL DEFAULT 'ACTIVE',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    payment_reference VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_player ON subscriptions(player_id);

CREATE TABLE practice_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    event_type event_type NOT NULL,
    session_data JSONB NOT NULL DEFAULT '{}'::jsonb, -- attempt-by-attempt log
    total_score NUMERIC(8,2) NOT NULL DEFAULT 0,
    duration_seconds INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_practice_player ON practice_sessions(player_id);

-- ---------------------------------------------------------------------------
-- AUDIT LOG (security requirement: who changed what, when, from where)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(80) NOT NULL,
    entity VARCHAR(80),
    entity_id UUID,
    metadata JSONB,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- updated_at auto-touch trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
