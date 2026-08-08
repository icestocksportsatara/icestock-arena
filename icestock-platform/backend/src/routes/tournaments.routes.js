const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
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

module.exports = router;
