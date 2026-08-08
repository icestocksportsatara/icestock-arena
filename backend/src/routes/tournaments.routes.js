const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTournamentRegistrar } = require('../middleware/rbac');
const { recordAudit } = require('../utils/audit');
const { DEFAULT_CONFIG } = require('../services/scoringEngine');

const router = express.Router();
router.use(authenticate);
const ORGANIZERS = ['SUPER_ADMIN', 'COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'];
const EVENT_TYPES = ['TEAM_GAME', 'TEAM_TARGET', 'TEAM_DISTANCE', 'INDIVIDUAL_TARGET', 'INDIVIDUAL_DISTANCE', 'HEAD_TO_HEAD'];

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.post(
  '/',
  requireRole(...ORGANIZERS),
  [
    body('name').isString().trim().isLength({ min: 3, max: 200 }),
    body('level').isIn(['INTERNATIONAL', 'NATIONAL', 'STATE', 'DISTRICT']),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
    body('events').isArray({ min: 1 }),
    body('events.*.eventType').isIn(EVENT_TYPES),
    body('events.*.category').isIn(['MEN', 'WOMEN', 'MIXED', 'YOUTH_BOYS', 'YOUTH_GIRLS']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const actor = req.user;
      const { name, level, venue, startDate, endDate, events } = req.body;
      let { countryId, stateId, districtId } = req.body;

      if (actor.role === 'COUNTRY_HEAD') countryId = actor.country_id;
      if (actor.role === 'STATE_HEAD') stateId = actor.state_id;
      if (actor.role === 'DISTRICT_HEAD') districtId = actor.district_id;

      const { rows: tRows } = await query(
        `INSERT INTO tournaments (name, level, country_id, state_id, district_id, venue, start_date, end_date, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT') RETURNING *`,
        [name, level, countryId || null, stateId || null, districtId || null, venue || null, startDate, endDate, actor.id]
      );
      const tournament = tRows[0];

      const createdEvents = [];
      for (const ev of events) {
        const cfg = DEFAULT_CONFIG[ev.eventType];
        const { rows } = await query(
          `INSERT INTO tournament_events (tournament_id, event_type, category, format_config)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [tournament.id, ev.eventType, ev.category, JSON.stringify({ ...cfg, ...(ev.formatConfig || {}) })]
        );
        createdEvents.push(rows[0]);
      }

      await recordAudit({ userId: actor.id, action: 'TOURNAMENT_CREATED', entity: 'tournament', entityId: tournament.id, req });
      res.status(201).json({ tournament, events: createdEvents });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const { status, level } = req.query;
    const params = [];
    let where = '1=1';
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (level) { params.push(level); where += ` AND level = $${params.length}`; }
    const { rows } = await query(`SELECT * FROM tournaments WHERE ${where} ORDER BY start_date DESC LIMIT 300`, params);
    res.json({ tournaments: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Tournament not found.' });
    const { rows: events } = await query('SELECT * FROM tournament_events WHERE tournament_id = $1', [req.params.id]);
    res.json({ tournament: rows[0], events });
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireRole(...ORGANIZERS), [body('status').isIn(['DRAFT', 'REGISTRATION_OPEN', 'ONGOING', 'COMPLETED', 'CANCELLED'])], validate, async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE tournaments SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Tournament not found.' });
    await recordAudit({ userId: req.user.id, action: 'TOURNAMENT_STATUS_CHANGED', entity: 'tournament', entityId: req.params.id, metadata: { status: req.body.status }, req });
    res.json({ tournament: rows[0] });
  } catch (err) { next(err); }
});

/** Schedule a match within a tournament event. Referee assignment happens here (admin/organizer only). */
router.post(
  '/:id/events/:eventId/matches',
  requireRole(...ORGANIZERS),
  [
    body('teamAId').optional({ nullable: true }).isUUID(),
    body('teamBId').optional({ nullable: true }).isUUID(),
    body('playerAId').optional({ nullable: true }).isUUID(),
    body('playerBId').optional({ nullable: true }).isUUID(),
    body('refereeId').optional({ nullable: true }).isUUID(),
    body('scheduledAt').optional({ nullable: true }).isISO8601(),
    body('roundName').optional({ nullable: true }).isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { teamAId, teamBId, playerAId, playerBId, refereeId, scheduledAt, roundName, venueLane } = req.body;
      const { rows } = await query(
        `INSERT INTO matches (tournament_event_id, round_name, team_a_id, team_b_id, player_a_id, player_b_id,
                               referee_id, scheduled_at, venue_lane, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SCHEDULED') RETURNING *`,
        [req.params.eventId, roundName || null, teamAId || null, teamBId || null, playerAId || null, playerBId || null,
         refereeId || null, scheduledAt || null, venueLane || null]
      );
      await recordAudit({ userId: req.user.id, action: 'MATCH_SCHEDULED', entity: 'match', entityId: rows[0].id, req });
      res.status(201).json({ match: rows[0] });
    } catch (err) { next(err); }
  }
);

router.get('/:id/events/:eventId/matches', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM matches WHERE tournament_event_id = $1 ORDER BY scheduled_at NULLS LAST', [req.params.eventId]);
    res.json({ matches: rows });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------- */
/* Registrar assignment — ADMIN ONLY. This is what makes registration      */
/* "per assigned tournament": a Head can only register participants for   */
/* tournaments they've been explicitly assigned to here.                   */
/* ---------------------------------------------------------------------- */

/** POST /:tournamentId/registrars — assign a Head to this tournament. */
router.post(
  '/:tournamentId/registrars',
  requireRole('SUPER_ADMIN'),
  [body('userId').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const { rows: headRows } = await query(
        `SELECT id, role FROM users WHERE id = $1 AND role IN ('COUNTRY_HEAD','STATE_HEAD','DISTRICT_HEAD') AND is_active = true`,
        [req.body.userId]
      );
      if (!headRows[0]) return res.status(400).json({ error: 'User must be an active Country/State/District Head.' });

      const { rows } = await query(
        `INSERT INTO tournament_registrars (tournament_id, user_id, assigned_by)
         VALUES ($1,$2,$3)
         ON CONFLICT (tournament_id, user_id) DO NOTHING
         RETURNING *`,
        [req.params.tournamentId, req.body.userId, req.user.id]
      );
      await recordAudit({ userId: req.user.id, action: 'REGISTRAR_ASSIGNED', entity: 'tournament', entityId: req.params.tournamentId, metadata: { userId: req.body.userId }, req });
      res.status(201).json({ assignment: rows[0] || { alreadyAssigned: true } });
    } catch (err) { next(err); }
  }
);

/** DELETE /:tournamentId/registrars/:userId — revoke a Head's access to this tournament. */
router.delete('/:tournamentId/registrars/:userId', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    await query('DELETE FROM tournament_registrars WHERE tournament_id = $1 AND user_id = $2', [req.params.tournamentId, req.params.userId]);
    await recordAudit({ userId: req.user.id, action: 'REGISTRAR_REVOKED', entity: 'tournament', entityId: req.params.tournamentId, metadata: { userId: req.params.userId }, req });
    res.json({ message: 'Registrar access revoked.' });
  } catch (err) { next(err); }
});

/** GET /:tournamentId/registrars — list who can register participants for this tournament. */
router.get('/:tournamentId/registrars', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT tr.*, u.full_name, u.email, u.role AS user_role
       FROM tournament_registrars tr JOIN users u ON u.id = tr.user_id
       WHERE tr.tournament_id = $1 ORDER BY tr.assigned_at DESC`,
      [req.params.tournamentId]
    );
    res.json({ registrars: rows });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------- */
/* Tournament entries — a team/player being entered INTO a tournament.     */
/* Only SUPER_ADMIN or an assigned registrar may enter participants.       */
/* ---------------------------------------------------------------------- */

router.post(
  '/:tournamentId/entries',
  requireTournamentRegistrar(),
  [body('teamId').optional({ nullable: true }).isUUID(), body('playerId').optional({ nullable: true }).isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const { teamId, playerId } = req.body;
      if (!teamId && !playerId) return res.status(400).json({ error: 'Provide teamId or playerId.' });
      const { rows } = await query(
        `INSERT INTO tournament_entries (tournament_id, team_id, player_id, entered_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.tournamentId, teamId || null, playerId || null, req.user.id]
      );
      await recordAudit({ userId: req.user.id, action: 'TOURNAMENT_ENTRY_ADDED', entity: 'tournament', entityId: req.params.tournamentId, metadata: { teamId, playerId }, req });
      res.status(201).json({ entry: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Already entered into this tournament.' });
      next(err);
    }
  }
);

/** GET /:tournamentId/entries — who's entered so far (any authenticated role can view). */
router.get('/:tournamentId/entries', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT te.*, t.name AS team_name, p.full_name AS player_name
       FROM tournament_entries te
       LEFT JOIN teams t ON t.id = te.team_id
       LEFT JOIN players p ON p.id = te.player_id
       WHERE te.tournament_id = $1 ORDER BY te.entered_at DESC`,
      [req.params.tournamentId]
    );
    res.json({ entries: rows });
  } catch (err) { next(err); }
});

/** GET /:tournamentId/participant-count — official headcount per event, for reporting. */
router.get('/:tournamentId/participant-count', async (req, res, next) => {
  try {
    const { rows: totals } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE team_id IS NOT NULL) AS team_entries,
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
       FROM tournament_events te
       LEFT JOIN matches m ON m.tournament_event_id = te.id
       WHERE te.tournament_id = $1
       GROUP BY te.event_type, te.category`,
      [req.params.tournamentId]
    );
    res.json({ totals: totals[0], byEvent });
  } catch (err) { next(err); }
});

module.exports = router;
