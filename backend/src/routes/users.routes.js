const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { hashPassword } = require('../utils/password');
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

function generateTempPassword() {
  // 16-char random password handed to the new user out-of-band; they must
  // change it on first login (must_change_password defaults to true).
  return crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '') + 'Aa1!';
}

/**
 * POST /api/users
 * - SUPER_ADMIN may create any role: COUNTRY_HEAD, STATE_HEAD, DISTRICT_HEAD, REFEREE, PLAYER
 * - COUNTRY_HEAD / STATE_HEAD / DISTRICT_HEAD may only create PLAYER accounts
 *   within their own scope (registration duty).
 */
router.post(
  '/',
  [
    body('fullName').isString().trim().isLength({ min: 2, max: 150 }),
    body('email').isEmail().normalizeEmail(),
    body('role').isIn(['COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD', 'REFEREE', 'PLAYER']),
    body('countryId').optional({ nullable: true }).isUUID(),
    body('stateId').optional({ nullable: true }).isUUID(),
    body('districtId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const actor = req.user;
      const { fullName, email, role, countryId, stateId, districtId, phone } = req.body;

      const canCreate =
        actor.role === 'SUPER_ADMIN' ||
        (['COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'].includes(actor.role) && role === 'PLAYER');
      if (!canCreate) {
        return res.status(403).json({ error: 'You are not permitted to create this role of account.' });
      }

      // Non-admin creators are pinned to their own scope regardless of body input.
      let scopedCountry = countryId || null;
      let scopedState = stateId || null;
      let scopedDistrict = districtId || null;
      if (actor.role === 'COUNTRY_HEAD') scopedCountry = actor.country_id;
      if (actor.role === 'STATE_HEAD') { scopedCountry = null; scopedState = actor.state_id; }
      if (actor.role === 'DISTRICT_HEAD') { scopedState = null; scopedDistrict = actor.district_id; }

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);

      const { rows } = await query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, country_id, state_id, district_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, full_name, email, role, country_id, state_id, district_id, created_at`,
        [fullName, email, phone || null, passwordHash, role, scopedCountry, scopedState, scopedDistrict, actor.id]
      );

      await recordAudit({
        userId: actor.id,
        action: 'USER_CREATED',
        entity: 'user',
        entityId: rows[0].id,
        metadata: { role },
        req,
      });

      // In production: email the temp password via a transactional email
      // service rather than returning it in the API response. Returned
      // here only so the creating admin/head can hand it over securely.
      res.status(201).json({ user: rows[0], tempPassword });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A user with this email already exists.' });
      next(err);
    }
  }
);

/** GET /api/users — SUPER_ADMIN only, full directory with optional role filter. */
router.get('/', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { role } = req.query;
    const params = [];
    let sql = `SELECT id, full_name, email, role, country_id, state_id, district_id, is_active, last_login_at, created_at
               FROM users`;
    if (role) {
      params.push(role);
      sql += ` WHERE role = $1`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/users/:id/status — activate/deactivate an account. */
router.patch(
  '/:id/status',
  requireRole('SUPER_ADMIN'),
  [body('isActive').isBoolean()],
  validate,
  async (req, res, next) => {
    try {
      const { isActive } = req.body;
      const { rows } = await query(
        'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, is_active',
        [isActive, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
      await recordAudit({
        userId: req.user.id,
        action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        entity: 'user',
        entityId: req.params.id,
        req,
      });
      res.json({ user: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
