const express = require('express');
const path = require('path');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { recordAudit } = require('../utils/audit');
const { generateScorecard, generateRegistrationForm, generateParticipantReport } = require('../services/pdfService');

const router = express.Router();
router.use(authenticate);

/** POST /api/scorecards/matches/:matchId — generate (referee/admin only, match must be COMPLETED). */
router.post('/matches/:matchId', requireRole('REFEREE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const matchId = req.params.matchId;
    const { rows: mRows } = await query('SELECT * FROM matches WHERE id = $1', [matchId]);
    const match = mRows[0];
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    if (match.status !== 'COMPLETED') return res.status(400).json({ error: 'Match must be finalized before a scorecard can be generated.' });
    if (req.user.role !== 'SUPER_ADMIN' && match.referee_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the assigned referee can generate this scorecard.' });
    }

    const { rows: evRows } = await query(
      `SELECT te.*, t.name as tournament_name, t.level, t.venue, t.start_date, t.end_date
       FROM tournament_events te JOIN tournaments t ON t.id = te.tournament_id WHERE te.id = $1`,
      [match.tournament_event_id]
    );
    const event = evRows[0];
    const tournament = { name: event.tournament_name, level: event.level, venue: event.venue, start_date: event.start_date, end_date: event.end_date };

    const isTeamEvent = ['TEAM_GAME', 'TEAM_TARGET', 'TEAM_DISTANCE'].includes(event.event_type);
    let aName = 'TBD';
    let bName = 'TBD';
    if (isTeamEvent) {
      const { rows } = await query('SELECT id, name FROM teams WHERE id = ANY($1)', [[match.team_a_id, match.team_b_id].filter(Boolean)]);
      aName = rows.find((r) => r.id === match.team_a_id)?.name || 'TBD';
      bName = rows.find((r) => r.id === match.team_b_id)?.name || 'TBD';
    } else {
      const { rows } = await query('SELECT id, full_name FROM players WHERE id = ANY($1)', [[match.player_a_id, match.player_b_id].filter(Boolean)]);
      aName = rows.find((r) => r.id === match.player_a_id)?.full_name || 'TBD';
      bName = rows.find((r) => r.id === match.player_b_id)?.full_name || 'TBD';
    }

    let raw = [];
    if (event.event_type === 'TEAM_GAME') raw = (await query('SELECT * FROM team_game_turns WHERE match_id = $1 ORDER BY turn_number', [matchId])).rows;
    else if (['TEAM_TARGET', 'INDIVIDUAL_TARGET'].includes(event.event_type)) raw = (await query('SELECT * FROM target_attempts WHERE match_id = $1 ORDER BY round_number, attempt_number', [matchId])).rows;
    else if (['TEAM_DISTANCE', 'INDIVIDUAL_DISTANCE'].includes(event.event_type)) raw = (await query('SELECT * FROM distance_attempts WHERE match_id = $1 ORDER BY attempt_number', [matchId])).rows;
    else if (event.event_type === 'HEAD_TO_HEAD') raw = (await query('SELECT * FROM head_to_head_rounds WHERE match_id = $1 ORDER BY round_number', [matchId])).rows;

    const referee = req.user;
    const { filePath, fileHash } = await generateScorecard({ match, tournament, event, participants: { aName, bName }, rawEntries: raw, referee });

    const { rows } = await query(
      `INSERT INTO scorecards (match_id, file_path, file_hash, generated_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [matchId, filePath, fileHash, req.user.id]
    );

    await recordAudit({ userId: req.user.id, action: 'SCORECARD_GENERATED', entity: 'match', entityId: matchId, req });
    res.status(201).json({ scorecard: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** GET /api/scorecards/matches/:matchId — list/download available scorecards (any authenticated role). */
router.get('/matches/:matchId', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM scorecards WHERE match_id = $1 ORDER BY generated_at DESC', [req.params.matchId]);
    res.json({ scorecards: rows });
  } catch (err) { next(err); }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM scorecards WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Scorecard not found.' });
    res.download(path.resolve(rows[0].file_path), `scorecard_${rows[0].match_id}.pdf`);
  } catch (err) { next(err); }
});

/** GET /api/scorecards/players/:playerId/registration-form — printable official player registration PDF. */
router.get('/players/:playerId/registration-form', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, t.name AS team_name FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id = $1`,
      [req.params.playerId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Player not found.' });
    const { filePath } = await generateRegistrationForm({ type: 'player', record: rows[0], registeredBy: req.user });
    await recordAudit({ userId: req.user.id, action: 'REGISTRATION_FORM_GENERATED', entity: 'player', entityId: req.params.playerId, req });
    res.download(path.resolve(filePath), `registration_${rows[0].full_name.replace(/\s+/g, '_')}.pdf`);
  } catch (err) { next(err); }
});

/** GET /api/scorecards/teams/:teamId/registration-form — printable official team registration PDF. */
router.get('/teams/:teamId/registration-form', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM teams WHERE id = $1', [req.params.teamId]);
    if (!rows[0]) return res.status(404).json({ error: 'Team not found.' });
    const { filePath } = await generateRegistrationForm({ type: 'team', record: rows[0], registeredBy: req.user });
    await recordAudit({ userId: req.user.id, action: 'REGISTRATION_FORM_GENERATED', entity: 'team', entityId: req.params.teamId, req });
    res.download(path.resolve(filePath), `registration_${rows[0].name.replace(/\s+/g, '_')}.pdf`);
  } catch (err) { next(err); }
});

/** GET /api/scorecards/tournaments/:tournamentId/participant-report — official headcount PDF, admin/heads only. */
router.get(
  '/tournaments/:tournamentId/participant-report',
  requireRole('SUPER_ADMIN', 'COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'),
  async (req, res, next) => {
    try {
      const { rows: tRows } = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.tournamentId]);
      if (!tRows[0]) return res.status(404).json({ error: 'Tournament not found.' });

      const { rows: totalsRows } = await query(
        `SELECT COUNT(*) FILTER (WHERE team_id IS NOT NULL) AS team_entries,
                COUNT(*) FILTER (WHERE player_id IS NOT NULL) AS player_entries
         FROM tournament_entries WHERE tournament_id = $1`,
        [req.params.tournamentId]
      );
      const { rows: byEvent } = await query(
        `SELECT te.event_type, te.category,
                COUNT(DISTINCT m.team_a_id) FILTER (WHERE m.team_a_id IS NOT NULL) +
                COUNT(DISTINCT m.team_b_id) FILTER (WHERE m.team_b_id IS NOT NULL) AS teams_in_matches,
                COUNT(DISTINCT m.player_a_id) FILTER (WHERE m.player_a_id IS NOT NULL) +
                COUNT(DISTINCT m.player_b_id) FILTER (WHERE m.player_b_id IS NOT NULL) AS players_in_matches
         FROM tournament_events te LEFT JOIN matches m ON m.tournament_event_id = te.id
         WHERE te.tournament_id = $1 GROUP BY te.event_type, te.category`,
        [req.params.tournamentId]
      );
      const { rows: entries } = await query(
        `SELECT te.*, t.name AS team_name, p.full_name AS player_name
         FROM tournament_entries te
         LEFT JOIN teams t ON t.id = te.team_id LEFT JOIN players p ON p.id = te.player_id
         WHERE te.tournament_id = $1 ORDER BY te.entered_at`,
        [req.params.tournamentId]
      );

      const { filePath } = await generateParticipantReport({ tournament: tRows[0], totals: totalsRows[0], byEvent, entries });
      await recordAudit({ userId: req.user.id, action: 'PARTICIPANT_REPORT_GENERATED', entity: 'tournament', entityId: req.params.tournamentId, req });
      res.download(path.resolve(filePath), `participants_${tRows[0].name.replace(/\s+/g, '_')}.pdf`);
    } catch (err) { next(err); }
  }
);

module.exports = router;
