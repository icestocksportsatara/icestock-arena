const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

/** Registration roles only; referees/players don't register teams. */
const REGISTRARS = ['SUPER_ADMIN', 'COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'];

router.post(
  '/',
  requireRole(...REGISTRARS),
  [
    body('name').isString().trim().isLength({ min: 2, max: 150 }),
    body('level').isIn(['INTERNATIONAL', 'NATIONAL', 'STATE', 'DISTRICT']),
    body('category').isIn(['MEN', 'WOMEN', 'MIXED', 'YOUTH_BOYS', 'YOUTH_GIRLS']),
    body('countryId').optional({ nullable: true }).isUUID(),
    body('stateId').optional({ nullable: true }).isUUID(),
    body('districtId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const actor = req.user;
      let { name, level, category, countryId, stateId, districtId } = req.body;

      // Pin geo scope to the actor's own jurisdiction unless SUPER_ADMIN.
      if (actor.role === 'COUNTRY_HEAD') countryId = actor.country_id;
      if (actor.role === 'STATE_HEAD') { countryId = countryId || null; stateId = actor.state_id; }
      if (actor.role === 'DISTRICT_HEAD') { stateId = stateId || null; districtId = actor.district_id; }

      const { rows } = await query(
        `INSERT INTO teams (name, level, category, country_id, state_id, district_id, registered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, level, category, countryId || null, stateId || null, districtId || null, actor.id]
      );
      await recordAudit({ userId: actor.id, action: 'TEAM_REGISTERED', entity: 'team', entityId: rows[0].id, req });
      res.status(201).json({ team: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/teams — scoped automatically to the caller's jurisdiction (admin sees all). */
router.get('/', async (req, res, next) => {
  try {
    const actor = req.user;
    const params = [];
    let where = '1=1';

    if (actor.role === 'COUNTRY_HEAD') { params.push(actor.country_id); where = `country_id = $${params.length}`; }
    else if (actor.role === 'STATE_HEAD') { params.push(actor.state_id); where = `state_id = $${params.length}`; }
    else if (actor.role === 'DISTRICT_HEAD') { params.push(actor.district_id); where = `district_id = $${params.length}`; }

    const { rows } = await query(
      `SELECT * FROM teams WHERE ${where} AND is_active = true ORDER BY created_at DESC LIMIT 500`,
      params
    );
    res.json({ teams: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Team not found.' });
    const { rows: players } = await query('SELECT * FROM players WHERE team_id = $1 AND is_active = true', [req.params.id]);
    res.json({ team: rows[0], players });
  } catch (err) {
    next(err);
  }
});

/**
 * Editing an existing team is SUPER_ADMIN-only. Heads can register new
 * teams within their scope, but cannot alter records afterward — this is
 * intentional per the platform's rule that only the admin can edit
 * anything once it's in the system.
 */
router.patch('/:id', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { name, isActive } = req.body;
    const { rows } = await query(
      `UPDATE teams SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *`,
      [name || null, typeof isActive === 'boolean' ? isActive : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Team not found.' });
    await recordAudit({ userId: req.user.id, action: 'TEAM_UPDATED', entity: 'team', entityId: req.params.id, req });
    res.json({ team: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
