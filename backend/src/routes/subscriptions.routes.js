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

/**
 * POST /api/subscriptions — activate/upgrade a plan for the logged-in player.
 * NOTE: This endpoint records the subscription state only. Wire it behind a
 * real payment provider (Stripe/Razorpay/etc.) webhook before production use —
 * never trust an unauthenticated client to self-report a successful payment.
 */
router.post(
  '/',
  requireRole('PLAYER'),
  [body('plan').isIn(['FREE', 'PRO', 'ELITE']), body('paymentReference').optional().isString()],
  validate,
  async (req, res, next) => {
    try {
      const { rows: playerRows } = await query('SELECT * FROM players WHERE user_id = $1', [req.user.id]);
      const player = playerRows[0];
      if (!player) return res.status(404).json({ error: 'No player profile linked to this account yet.' });

      const { plan, paymentReference } = req.body;
      const expiresAt = plan === 'FREE' ? null : new Date(Date.now() + 365 * 24 * 3600 * 1000);

      const { rows } = await query(
        `INSERT INTO subscriptions (player_id, plan, status, expires_at, payment_reference)
         VALUES ($1,$2,'ACTIVE',$3,$4) RETURNING *`,
        [player.id, plan, expiresAt, paymentReference || null]
      );
      await recordAudit({ userId: req.user.id, action: 'SUBSCRIPTION_CHANGED', entity: 'player', entityId: player.id, metadata: { plan }, req });
      res.status(201).json({ subscription: rows[0] });
    } catch (err) { next(err); }
  }
);

router.get('/me', requireRole('PLAYER'), async (req, res, next) => {
  try {
    const { rows: playerRows } = await query('SELECT * FROM players WHERE user_id = $1', [req.user.id]);
    if (!playerRows[0]) return res.status(404).json({ error: 'No player profile linked to this account yet.' });
    const { rows } = await query(
      `SELECT * FROM subscriptions WHERE player_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [playerRows[0].id]
    );
    res.json({ subscription: rows[0] || { plan: 'FREE', status: 'ACTIVE' } });
  } catch (err) { next(err); }
});

module.exports = router;
