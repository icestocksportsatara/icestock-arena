const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.get('/countries', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM countries WHERE is_active = true ORDER BY name');
    res.json({ countries: rows });
  } catch (err) { next(err); }
});

router.post(
  '/countries',
  authenticate,
  requireRole('SUPER_ADMIN'),
  [body('name').isString().trim().notEmpty(), body('isoCode').isString().trim().isLength({ min: 2, max: 3 })],
  validate,
  async (req, res, next) => {
    try {
      const { name, isoCode, federationName } = req.body;
      const { rows } = await query(
        'INSERT INTO countries (name, iso_code, federation_name) VALUES ($1,$2,$3) RETURNING *',
        [name, isoCode.toUpperCase(), federationName || null]
      );
      res.status(201).json({ country: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Country already exists.' });
      next(err);
    }
  }
);

router.get('/states', authenticate, async (req, res, next) => {
  try {
    const { countryId } = req.query;
    const { rows } = await query(
      'SELECT * FROM states WHERE is_active = true AND ($1::uuid IS NULL OR country_id = $1) ORDER BY name',
      [countryId || null]
    );
    res.json({ states: rows });
  } catch (err) { next(err); }
});

router.post(
  '/states',
  authenticate,
  requireRole('SUPER_ADMIN', 'COUNTRY_HEAD'),
  [body('name').isString().trim().notEmpty(), body('countryId').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const { name, countryId } = req.body;
      if (req.user.role === 'COUNTRY_HEAD' && req.user.country_id !== countryId) {
        return res.status(403).json({ error: 'Outside your country scope.' });
      }
      const { rows } = await query(
        'INSERT INTO states (country_id, name) VALUES ($1,$2) RETURNING *',
        [countryId, name]
      );
      res.status(201).json({ state: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'State already exists in this country.' });
      next(err);
    }
  }
);

router.get('/districts', authenticate, async (req, res, next) => {
  try {
    const { stateId } = req.query;
    const { rows } = await query(
      'SELECT * FROM districts WHERE is_active = true AND ($1::uuid IS NULL OR state_id = $1) ORDER BY name',
      [stateId || null]
    );
    res.json({ districts: rows });
  } catch (err) { next(err); }
});

router.post(
  '/districts',
  authenticate,
  requireRole('SUPER_ADMIN', 'COUNTRY_HEAD', 'STATE_HEAD'),
  [body('name').isString().trim().notEmpty(), body('stateId').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const { name, stateId } = req.body;
      if (req.user.role === 'STATE_HEAD' && req.user.state_id !== stateId) {
        return res.status(403).json({ error: 'Outside your state scope.' });
      }
      const { rows } = await query(
        'INSERT INTO districts (state_id, name) VALUES ($1,$2) RETURNING *',
        [stateId, name]
      );
      res.status(201).json({ district: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'District already exists in this state.' });
      next(err);
    }
  }
);

module.exports = router;
