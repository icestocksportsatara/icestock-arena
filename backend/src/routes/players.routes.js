const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);
const REGISTRARS = ['SUPER_ADMIN', 'COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'];

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.post(
  '/',
  requireRole(...REGISTRARS),
  [
    body('fullName').isString().trim().isLength({ min: 2, max: 150 }),
    body('teamId').optional({ nullable: true }).isUUID(),
    body('dateOfBirth').optional({ nullable: true }).isISO8601(),
    body('gender').optional({ nullable: true }).isString(),
    body('jerseyNumber').optional({ nullable: true }).isInt({ min: 0, max: 999 }),
    body('licenceNumber').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const actor = req.user;
      const { fullName, teamId, dateOfBirth, gender, jerseyNumber, licenceNumber } = req.body;

      const countryId = actor.role === 'SUPER_ADMIN' ? req.body.countryId || null : actor.country_id;
      const stateId = actor.role === 'DISTRICT_HEAD' || actor.role === 'STATE_HEAD' ? actor.state_id : req.body.stateId || null;
      const districtId = actor.role === 'DISTRICT_HEAD' ? actor.district_id : req.body.districtId || null;

      const { rows } = await query(
        `INSERT INTO players (team_id, full_name, date_of_birth, gender, jersey_number, licence_number,
                               country_id, state_id, district_id, registered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          teamId || null, fullName, dateOfBirth || null, gender || null, jerseyNumber || null,
          licenceNumber || null, countryId, stateId, districtId, actor.id,
        ]
      );
      await recordAudit({ userId: actor.id, action: 'PLAYER_REGISTERED', entity: 'player', entityId: rows[0].id, req });
      res.status(201).json({ player: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Licence number already in use.' });
      next(err);
    }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = req.query;
    const actor = req.user;
    const params = [];
    let where = '1=1';

    if (teamId) { params.push(teamId); where += ` AND team_id = $${params.length}`; }
    if (actor.role === 'COUNTRY_HEAD') { params.push(actor.country_id); where += ` AND country_id = $${params.length}`; }
    if (actor.role === 'STATE_HEAD') { params.push(actor.state_id); where += ` AND state_id = $${params.length}`; }
    if (actor.role === 'DISTRICT_HEAD') { params.push(actor.district_id); where += ` AND district_id = $${params.length}`; }

    const { rows } = await query(
      `SELECT * FROM players WHERE ${where} AND is_active = true ORDER BY created_at DESC LIMIT 1000`,
      params
    );
    res.json({ players: rows });
  } catch (err) {
    next(err);
  }
});

/** Editing a player record (details, team, deactivation) — SUPER_ADMIN only. */
router.patch('/:id', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { fullName, teamId, jerseyNumber, isActive } = req.body;
    const { rows } = await query(
      `UPDATE players SET
         full_name = COALESCE($1, full_name),
         team_id = COALESCE($2, team_id),
         jersey_number = COALESCE($3, jersey_number),
         is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [fullName || null, teamId || null, jerseyNumber || null, typeof isActive === 'boolean' ? isActive : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Player not found.' });
    await recordAudit({ userId: req.user.id, action: 'PLAYER_UPDATED', entity: 'player', entityId: req.params.id, req });
    res.json({ player: rows[0] });
  } catch (err) { next(err); }
});

/** Link an existing player record to a login account (creates PLAYER user first via /api/users). SUPER_ADMIN only. */
router.patch('/:id/link-user', requireRole('SUPER_ADMIN'), [body('userId').isUUID()], validate, async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE players SET user_id = $1 WHERE id = $2 RETURNING *', [req.body.userId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Player not found.' });
    await recordAudit({ userId: req.user.id, action: 'PLAYER_LINKED_USER', entity: 'player', entityId: req.params.id, req });
    res.json({ player: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
