const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { verifyPassword, hashPassword, isStrongPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/jwt');
const { loginLimiter } = require('../middleware/security');
const { authenticate } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
const MAX_FAILED_ATTEMPTS = 6;
const LOCK_MINUTES = 15;

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

/**
 * POST /api/auth/login
 * Single-step email + password login for every role. (An earlier version
 * of this platform added a mandatory emailed OTP step here — it was removed
 * because it made login depend on third-party SMTP delivery being correctly
 * configured, which was unreliable to set up quickly. The OTP building
 * blocks — utils/otp.js, services/emailService.js, the otp_codes table —
 * are still in the codebase and safe to leave unused if you want to
 * re-enable two-step login later with a properly tested email provider.)
 */
router.post(
  '/login',
  loginLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').isString().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];

      // Constant-shape response whether or not the user exists, to avoid
      // leaking which emails are registered.
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ error: 'Account temporarily locked due to failed attempts. Try again later.' });
      }
      if (!user.is_active) {
        return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        const attempts = user.failed_login_attempts + 1;
        const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
        await query('UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockUntil, user.id]);
        await recordAudit({ userId: user.id, action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, req });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);

      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
         VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
        [user.id, hashToken(refreshToken), req.headers['user-agent'] || null, req.ip]
      );

      await recordAudit({ userId: user.id, action: 'LOGIN_SUCCESS', entity: 'user', entityId: user.id, req });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          role: user.role,
          countryId: user.country_id,
          stateId: user.state_id,
          districtId: user.district_id,
          mustChangePassword: user.must_change_password,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/auth/refresh — rotate a refresh token for a new access token. */
router.post('/refresh', [body('refreshToken').isString().notEmpty()], validate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    const tokenHash = hashToken(refreshToken);
    const { rows } = await query(
      `SELECT * FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.sub, tokenHash]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Refresh token not recognized. Please log in again.' });

    const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.sub]);
    const user = userRows[0];
    if (!user) return res.status(401).json({ error: 'Account no longer active.' });

    // Rotate: revoke old, issue new
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [rows[0].id]);
    const newRefresh = signRefreshToken(user);
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
      [user.id, hashToken(newRefresh), req.headers['user-agent'] || null, req.ip]
    );

    res.json({ accessToken: signAccessToken(user), refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/logout — revoke the presented refresh token only (this device). */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(refreshToken)]);
    }
    await recordAudit({ userId: req.user.id, action: 'LOGOUT', entity: 'user', entityId: req.user.id, req });
    res.json({ message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/sessions — list this account's active sessions/devices. */
router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, user_agent, ip_address, created_at, expires_at,
              (revoked_at IS NULL AND expires_at > now()) AS active
       FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [req.user.id]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

/** POST /api/auth/sessions/:id/revoke — sign out one specific device/session. */
router.post('/sessions/:id/revoke', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Session not found.' });
    await recordAudit({ userId: req.user.id, action: 'SESSION_REVOKED', entity: 'user', entityId: req.user.id, metadata: { sessionId: req.params.id }, req });
    res.json({ message: 'Session revoked.' });
  } catch (err) { next(err); }
});

/** POST /api/auth/sessions/revoke-all — sign out everywhere (e.g. after a suspected compromise). */
router.post('/sessions/revoke-all', authenticate, async (req, res, next) => {
  try {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
    await recordAudit({ userId: req.user.id, action: 'ALL_SESSIONS_REVOKED', entity: 'user', entityId: req.user.id, req });
    res.json({ message: 'All sessions revoked. You will need to log in again on every device.' });
  } catch (err) { next(err); }
});

/** POST /api/auth/change-password — required for first login on all admin-created accounts. */
router.post(
  '/change-password',
  authenticate,
  [body('currentPassword').isString().notEmpty(), body('newPassword').isString().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      const user = rows[0];
      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          error: 'Password must be 10+ characters and include upper, lower, number, and symbol.',
        });
      }
      const newHash = await hashPassword(newPassword);
      await query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [newHash, req.user.id]);
      // Changing the password invalidates every other session as a precaution.
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
      await recordAudit({ userId: req.user.id, action: 'PASSWORD_CHANGED', entity: 'user', entityId: req.user.id, req });
      res.json({ message: 'Password updated. Please log in again.' });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/auth/me — current session info. */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
