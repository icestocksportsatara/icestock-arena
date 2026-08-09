const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

async function getPlayerForUser(userId) {
  const { rows } = await query('SELECT * FROM players WHERE user_id = $1', [userId]);
  return rows[0];
}

async function getActiveSubscription(playerId) {
  const { rows } = await query(
    `SELECT * FROM subscriptions WHERE player_id = $1 AND status = 'ACTIVE'
     AND (expires_at IS NULL OR expires_at > now()) ORDER BY started_at DESC LIMIT 1`,
    [playerId]
  );
  return rows[0] || { plan: 'FREE', status: 'ACTIVE' };
}

/** GET /api/stats/me — a player's own official match history + aggregate analytics. */
router.get('/me', requireRole('PLAYER'), async (req, res, next) => {
  try {
    const player = await getPlayerForUser(req.user.id);
    if (!player) return res.status(404).json({ error: 'No player profile linked to this account yet.' });

    const subscription = await getActiveSubscription(player.id);

    const { rows: matches } = await query(
      `SELECT m.id, m.status, m.completed_at, m.result, te.event_type, te.category
       FROM matches m JOIN tournament_events te ON te.id = m.tournament_event_id
       WHERE m.player_a_id = $1 OR m.player_b_id = $1
       ORDER BY m.completed_at DESC NULLS LAST LIMIT 100`,
      [player.id]
    );

    // Basic analytics available to all tiers; deeper breakdowns gated to PRO/ELITE.
    const totalMatches = matches.filter((m) => m.status === 'COMPLETED').length;
    const wins = matches.filter((m) => {
      if (m.status !== 'COMPLETED' || !m.result) return false;
      const w = m.result.winner;
      return (w === 'PLAYER_A') || (w === 'PLAYER_B');
    }).length; // simplified; real "did I win" check happens client-side using player_a/b id

    const basicStats = { totalMatches, plan: subscription.plan };

    let advancedStats = null;
    if (['PRO', 'ELITE'].includes(subscription.plan)) {
      const { rows: targetRows } = await query(
        `SELECT ta.round_number, ta.points_scored FROM target_attempts ta WHERE ta.participant_player_id = $1`,
        [player.id]
      );
      const { rows: distRows } = await query(
        `SELECT da.distance_m, da.zone_points FROM distance_attempts da WHERE da.participant_player_id = $1`,
        [player.id]
      );
      advancedStats = {
        targetAvgPointsPerAttempt: avg(targetRows.map((r) => r.points_scored)),
        distanceAvgMeters: avg(distRows.map((r) => Number(r.distance_m))),
        distanceBestMeters: Math.max(0, ...distRows.map((r) => Number(r.distance_m))),
        consistencyIndex: stdDev(targetRows.map((r) => r.points_scored)),
        // "Potential" score: a simple composite the platform can refine over time.
        potentialRating: computePotential(targetRows, distRows),
      };
    }

    res.json({ player, subscription, basicStats, advancedStats, recentMatches: matches.slice(0, 20) });
  } catch (err) {
    next(err);
  }
});

function avg(arr) { return arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : 0; }
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}
function computePotential(targetRows, distRows) {
  const t = avg(targetRows.map((r) => r.points_scored)) / 10; // normalize vs max ring score
  const d = avg(distRows.map((r) => r.zone_points)) / 5; // normalize vs max zone
  return Math.round(((t + d) / 2) * 100); // 0-100 composite
}

/** POST /api/stats/practice — log a practice-mode session (subscription may cap frequency/detail in future). */
router.post(
  '/practice',
  requireRole('PLAYER'),
  [
    body('eventType').isIn(['TEAM_GAME', 'TEAM_TARGET', 'TEAM_DISTANCE', 'INDIVIDUAL_TARGET', 'INDIVIDUAL_DISTANCE', 'HEAD_TO_HEAD']),
    body('sessionData').isObject(),
    body('totalScore').isFloat({ min: 0 }),
    body('durationSeconds').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const player = await getPlayerForUser(req.user.id);
      if (!player) return res.status(404).json({ error: 'No player profile linked to this account yet.' });
      const { eventType, sessionData, totalScore, durationSeconds } = req.body;
      const { rows } = await query(
        `INSERT INTO practice_sessions (player_id, event_type, session_data, total_score, duration_seconds)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [player.id, eventType, JSON.stringify(sessionData), totalScore, durationSeconds || null]
      );
      res.status(201).json({ session: rows[0] });
    } catch (err) { next(err); }
  }
);

router.get('/practice', requireRole('PLAYER'), async (req, res, next) => {
  try {
    const player = await getPlayerForUser(req.user.id);
    if (!player) return res.status(404).json({ error: 'No player profile linked to this account yet.' });
    const { rows } = await query('SELECT * FROM practice_sessions WHERE player_id = $1 ORDER BY created_at DESC LIMIT 100', [player.id]);
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

/** Public-ish leaderboard for a tournament event (any authenticated role can view). */
router.get('/leaderboard/:tournamentEventId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, result, team_a_id, team_b_id, player_a_id, player_b_id, status
       FROM matches WHERE tournament_event_id = $1 AND status = 'COMPLETED'`,
      [req.params.tournamentEventId]
    );
    res.json({ matches: rows });
  } catch (err) { next(err); }
});

module.exports = router;
