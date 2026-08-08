const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

/**
 * Everything in this file is intentionally UNAUTHENTICATED. This is the
 * "big event" live-scoring display service — spectators, venue screens,
 * and embedded widgets read from here without a login, the same way a
 * professional sports platform's public scoreboard works. It is strictly
 * read-only: no route here writes anything.
 */

/** GET /api/public/tournaments — currently live/ongoing tournaments, for a homepage list. */
router.get('/tournaments', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, level, venue, start_date, end_date, status
       FROM tournaments WHERE status IN ('ONGOING','REGISTRATION_OPEN')
       ORDER BY start_date DESC LIMIT 50`
    );
    res.json({ tournaments: rows });
  } catch (err) { next(err); }
});

/** GET /api/public/tournaments/:id — tournament + its events, public view. */
router.get('/tournaments/:id', async (req, res, next) => {
  try {
    const { rows: tRows } = await query(
      `SELECT id, name, level, venue, start_date, end_date, status FROM tournaments WHERE id = $1`,
      [req.params.id]
    );
    if (!tRows[0]) return res.status(404).json({ error: 'Tournament not found.' });
    const { rows: events } = await query(
      `SELECT id, event_type, category FROM tournament_events WHERE tournament_id = $1 AND is_active = true`,
      [req.params.id]
    );
    res.json({ tournament: tRows[0], events });
  } catch (err) { next(err); }
});

/** GET /api/public/events/:eventId/matches — live/completed matches for the public board. */
router.get('/events/:eventId/matches', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.round_name, m.status, m.result, m.venue_lane, m.started_at, m.completed_at,
              ta.name AS team_a_name, tb.name AS team_b_name,
              pa.full_name AS player_a_name, pb.full_name AS player_b_name
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN players pa ON pa.id = m.player_a_id
       LEFT JOIN players pb ON pb.id = m.player_b_id
       WHERE m.tournament_event_id = $1
       ORDER BY (m.status = 'LIVE') DESC, m.scheduled_at NULLS LAST`,
      [req.params.eventId]
    );
    res.json({ matches: rows });
  } catch (err) { next(err); }
});

/** GET /api/public/matches/:matchId — a single match's live scoreboard data. */
router.get('/matches/:matchId', async (req, res, next) => {
  try {
    const { rows: mRows } = await query(
      `SELECT m.*, te.event_type, te.category,
              ta.name AS team_a_name, tb.name AS team_b_name,
              pa.full_name AS player_a_name, pb.full_name AS player_b_name
       FROM matches m
       JOIN tournament_events te ON te.id = m.tournament_event_id
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN players pa ON pa.id = m.player_a_id
       LEFT JOIN players pb ON pb.id = m.player_b_id
       WHERE m.id = $1`,
      [req.params.matchId]
    );
    const match = mRows[0];
    if (!match) return res.status(404).json({ error: 'Match not found.' });

    let raw = [];
    const eventType = match.event_type;
    if (eventType === 'TEAM_GAME') raw = (await query('SELECT * FROM team_game_turns WHERE match_id = $1 ORDER BY turn_number', [match.id])).rows;
    else if (['TEAM_TARGET', 'INDIVIDUAL_TARGET'].includes(eventType)) raw = (await query('SELECT * FROM target_attempts WHERE match_id = $1', [match.id])).rows;
    else if (['TEAM_DISTANCE', 'INDIVIDUAL_DISTANCE'].includes(eventType)) raw = (await query('SELECT * FROM distance_attempts WHERE match_id = $1', [match.id])).rows;
    else if (eventType === 'HEAD_TO_HEAD') raw = (await query('SELECT * FROM head_to_head_rounds WHERE match_id = $1 ORDER BY round_number', [match.id])).rows;

    res.json({ match, rawEntries: raw });
  } catch (err) { next(err); }
});

module.exports = router;
