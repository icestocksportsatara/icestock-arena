-- ============================================================================
-- MIGRATION 002 — Tournament-scoped registration assignments
-- ============================================================================
-- Safe to run on a database that already has the base schema applied
-- (uses IF NOT EXISTS everywhere). Paste this whole file into your database
-- provider's SQL editor (e.g. Neon → SQL Editor) and run it once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tournament_registrars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_registrars_tournament ON tournament_registrars(tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrars_user ON tournament_registrars(user_id);

CREATE TABLE IF NOT EXISTS tournament_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    entered_by UUID NOT NULL REFERENCES users(id),
    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT entry_has_participant CHECK (team_id IS NOT NULL OR player_id IS NOT NULL),
    UNIQUE (tournament_id, team_id),
    UNIQUE (tournament_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_tournament ON tournament_entries(tournament_id);
