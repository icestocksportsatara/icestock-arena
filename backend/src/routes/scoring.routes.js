const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, withTransaction } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { recordAudit } = require('../utils/audit');
const { computeResult } = require('../services/scoringEngine');

const router = express.Router();
router.use(authenticate);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

/** Only the referee assigned to a match (or SUPER_ADMIN) may score it. */
async function assertAssignedReferee(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM matches WHERE id = $1', [req.params.matchId]);
    const match = rows[0];
    if (!match) return res.status(404).json({ error: 'Match not found.' });
    if (req.user.role !== 'SUPER_ADMIN' && match.referee_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not the assigned referee for this match.' });
    }
    req.match = match;
    next();
  } catch (err) {
    next(err);
  }
}

function getIo(req) {
  return req.app.get('io');
}

/** GET /matches/mine — matches assigned to the logged-in referee. */
router.get('/matches/mine', requireRole('REFEREE', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.*, te.event_type, te.category, t.name AS tournament_name
       FROM matches m
       JOIN tournament_events te ON te.id = m.tournament_event_id
       JOIN tournaments t ON t.id = te.tournament_id
       WHERE m.referee_id = $1
       ORDER BY m.scheduled_at NULLS LAST LIMIT 200`,
      [req.user.id]
    );
    res.json({ matches: rows });
  } catch (err) { next(err); }
});

/** Mark a match LIVE (referee starts the clock). */
router.post('/matches/:matchId/start', requireRole('REFEREE', 'SUPER_ADMIN'), assertAssignedReferee, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE matches SET status = 'LIVE', started_at = now() WHERE id = $1 RETURNING *`,
      [req.params.matchId]
    );
    getIo(req)?.to(`match:${req.params.matchId}`).emit('match:started', rows[0]);
    res.json({ match: rows[0] });
  } catch (err) { next(err); }
});

/** 1) TEAM_GAME — submit one turn (0-4 points each side). */
router.post(
  '/matches/:matchId/team-game/turn',
  requireRole('REFEREE', 'SUPER_ADMIN'),
  assertAssignedReferee,
  [body('turnNumber').isInt({ min: 1, max: 12 }), body('teamAPoints').isInt({ min: 0, max: 4 }), body('teamBPoints').isInt({ min: 0, max: 4 })],
  validate,
  async (req, res, next) => {
    try {
      const { turnNumber, teamAPoints, teamBPoints } = req.body;
      const { rows } = await query(
        `INSERT INTO team_game_turns (match_id, turn_number, team_a_points, team_b_points, recorded_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (match_id, turn_number) DO UPDATE SET team_a_points = $3, team_b_points = $4, recorded_by = $5, recorded_at = now()
         RETURNING *`,
        [req.params.matchId, turnNumber, teamAPoints, teamBPoints, req.user.id]
      );
      getIo(req)?.to(`match:${req.params.matchId}`).emit('score:update', { event: 'TEAM_GAME', turn: rows[0] });
      res.status(201).json({ turn: rows[0] });
    } catch (err) { next(err); }
  }
);

/** 2 & Individual variants) TARGET — submit one attempt. */
router.post(
  '/matches/:matchId/target/attempt',
  requireRole('REFEREE', 'SUPER_ADMIN'),
  assertAssignedReferee,
  [
    body('participantTeamId').optional({ nullable: true }).isUUID(),
    body('participantPlayerId').optional({ nullable: true }).isUUID(),
    body('roundNumber').isInt({ min: 1, max: 4 }),
    body('attemptNumber').isInt({ min: 1, max: 6 }),
    body('pointsScored').isInt({ min: 0, max: 10 }),
    body('scenarioCode').optional({ nullable: true }).isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { participantTeamId, participantPlayerId, roundNumber, attemptNumber, pointsScored, scenarioCode } = req.body;
      if (!participantTeamId && !participantPlayerId) {
        return res.status(400).json({ error: 'Provide participantTeamId or participantPlayerId.' });
      }
      const { rows } = await query(
        `INSERT INTO target_attempts
           (match_id, participant_team_id, participant_player_id, round_number, attempt_number, points_scored, scenario_code, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (match_id, participant_team_id, participant_player_id, round_number, attempt_number)
         DO UPDATE SET points_scored = $6, scenario_code = $7, recorded_by = $8, recorded_at = now()
         RETURNING *`,
        [req.params.matchId, participantTeamId || null, participantPlayerId || null, roundNumber, attemptNumber, pointsScored, scenarioCode || null, req.user.id]
      );
      getIo(req)?.to(`match:${req.params.matchId}`).emit('score:update', { event: 'TARGET', attempt: rows[0] });
      res.status(201).json({ attempt: rows[0] });
    } catch (err) { next(err); }
  }
);

/** 3 & Individual variants) DISTANCE — submit one attempt (meters). */
router.post(
  '/matches/:matchId/distance/attempt',
  requireRole('REFEREE', 'SUPER_ADMIN'),
  assertAssignedReferee,
  [
    body('participantTeamId').optional({ nullable: true }).isUUID(),
    body('participantPlayerId').optional({ nullable: true }).isUUID(),
    body('attemptNumber').isInt({ min: 1, max: 20 }),
    body('distanceM').isFloat({ min: 0, max: 200 }),
    body('isFault').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { participantTeamId, participantPlayerId, attemptNumber, distanceM, isFault } = req.body;

      // Look up the event's distance zone config to pre-compute points server-side
      const { rows: eventRows } = await query(
        `SELECT te.format_config FROM tournament_events te
         JOIN matches m ON m.tournament_event_id = te.id WHERE m.id = $1`,
        [req.params.matchId]
      );
      const cfg = eventRows[0]?.format_config || {};
      const zones = cfg.distanceZones || [];
      const zonePoints = isFault ? 0 : (zones.find((z) => distanceM >= z.minM && distanceM < z.maxM)?.points || 0);

      const { rows } = await query(
        `INSERT INTO distance_attempts (match_id, participant_team_id, participant_player_id, attempt_number, distance_m, zone_points, is_fault, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.params.matchId, participantTeamId || null, participantPlayerId || null, attemptNumber, distanceM, zonePoints, !!isFault, req.user.id]
      );
      getIo(req)?.to(`match:${req.params.matchId}`).emit('score:update', { event: 'DISTANCE', attempt: rows[0] });
      res.status(201).json({ attempt: rows[0] });
    } catch (err) { next(err); }
  }
);

/** 4) HEAD_TO_HEAD — submit one round's result. */
router.post(
  '/matches/:matchId/head-to-head/round',
  requireRole('REFEREE', 'SUPER_ADMIN'),
  assertAssignedReferee,
  [
    body('roundNumber').isInt({ min: 1, max: 20 }),
    body('playerARoundPoints').isInt({ min: 0 }),
    body('playerBRoundPoints').isInt({ min: 0 }),
    body('playerARawScore').optional().isInt({ min: 0 }),
    body('playerBRawScore').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { roundNumber, playerARoundPoints, playerBRoundPoints, playerARawScore, playerBRawScore } = req.body;
      const { rows } = await query(
        `INSERT INTO head_to_head_rounds (match_id, round_number, player_a_round_points, player_b_round_points, player_a_raw_score, player_b_raw_score, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (match_id, round_number) DO UPDATE SET
           player_a_round_points = $3, player_b_round_points = $4,
           player_a_raw_score = $5, player_b_raw_score = $6, recorded_by = $7, recorded_at = now()
         RETURNING *`,
        [req.params.matchId, roundNumber, playerARoundPoints, playerBRoundPoints, playerARawScore || 0, playerBRawScore || 0, req.user.id]
      );
      getIo(req)?.to(`match:${req.params.matchId}`).emit('score:update', { event: 'HEAD_TO_HEAD', round: rows[0] });
      res.status(201).json({ round: rows[0] });
    } catch (err) { next(err); }
  }
);

/**
 * POST /matches/:matchId/finalize
 * Locks scoring, runs the scoring engine over the raw entries, and writes
 * the computed result. This is the only place `matches.result` is written —
 * never accept a hand-typed final score from the client.
 */
router.post('/matches/:matchId/finalize', requireRole('REFEREE', 'SUPER_ADMIN'), assertAssignedReferee, async (req, res, next) => {
  try {
    const matchId = req.params.matchId;
    const { rows: evRows } = await query(
      `SELECT te.event_type, te.format_config FROM tournament_events te
       JOIN matches m ON m.tournament_event_id = te.id WHERE m.id = $1`,
      [matchId]
    );
    const { event_type: eventType, format_config } = evRows[0];

    let raw;
    if (eventType === 'TEAM_GAME') {
      raw = (await query('SELECT * FROM team_game_turns WHERE match_id = $1 ORDER BY turn_number', [matchId])).rows;
    } else if (['TEAM_TARGET', 'INDIVIDUAL_TARGET'].includes(eventType)) {
      raw = (await query('SELECT * FROM target_attempts WHERE match_id = $1', [matchId])).rows;
    } else if (['TEAM_DISTANCE', 'INDIVIDUAL_DISTANCE'].includes(eventType)) {
      raw = (await query('SELECT * FROM distance_attempts WHERE match_id = $1', [matchId])).rows;
    } else if (eventType === 'HEAD_TO_HEAD') {
      raw = (await query('SELECT * FROM head_to_head_rounds WHERE match_id = $1 ORDER BY round_number', [matchId])).rows;
    }

    const result = computeResult(eventType, raw, format_config);

    const { rows } = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE matches SET status = 'COMPLETED', completed_at = now(), result = $1 WHERE id = $2 RETURNING *`,
        [JSON.stringify(result), matchId]
      );
      return r;
    });

    await recordAudit({ userId: req.user.id, action: 'MATCH_FINALIZED', entity: 'match', entityId: matchId, metadata: result, req });
    getIo(req)?.to(`match:${matchId}`).emit('match:finalized', rows[0]);
    res.json({ match: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** Live scoreboard read (any authenticated role, incl. players/public spectators via a lightweight endpoint). */
router.get('/matches/:matchId/live', async (req, res, next) => {
  try {
    const matchId = req.params.matchId;
    const { rows: mRows } = await query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (!mRows[0]) return res.status(404).json({ error: 'Match not found.' });
    const { rows: evRows } = await query('SELECT event_type FROM tournament_events WHERE id = $1', [mRows[0].tournament_event_id]);
    const eventType = evRows[0]?.event_type;

    let raw = [];
    if (eventType === 'TEAM_GAME') raw = (await query('SELECT * FROM team_game_turns WHERE match_id = $1 ORDER BY turn_number', [matchId])).rows;
    else if (['TEAM_TARGET', 'INDIVIDUAL_TARGET'].includes(eventType)) raw = (await query('SELECT * FROM target_attempts WHERE match_id = $1', [matchId])).rows;
    else if (['TEAM_DISTANCE', 'INDIVIDUAL_DISTANCE'].includes(eventType)) raw = (await query('SELECT * FROM distance_attempts WHERE match_id = $1', [matchId])).rows;
    else if (eventType === 'HEAD_TO_HEAD') raw = (await query('SELECT * FROM head_to_head_rounds WHERE match_id = $1 ORDER BY round_number', [matchId])).rows;

    res.json({ match: mRows[0], eventType, rawEntries: raw });
  } catch (err) { next(err); }
});

module.exports = router;
