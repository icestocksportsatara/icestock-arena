const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { verifyPassword, hashPassword, isStrongPassword } = require('../utils/password');
const {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken,
  signLoginTicket, verifyLoginTicket,
} = require('../utils/jwt');
const { generateOtpCode, hashOtp, verifyOtpHash } = require('../utils/otp');
const { sendOtpEmail } = require('../services/emailService');
const { loginLimiter } = require('../middleware/security');
const { authenticate } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
const MAX_FAILED_ATTEMPTS = 6;
const LOCK_MINUTES = 15;
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

/** Tight limiter specifically on OTP verification — this is the single most
 *  important brute-force surface in the whole auth flow (a 6-digit code
 *  has only 1,000,000 possibilities), so it gets its own strict budget
 *  independent of the general API limiter. */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please request a new code.' },
});

const otpResendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests. Please wait before requesting another.' },
});

async function issueOtp({ userId, purpose, req }) {
  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

  // Invalidate any still-active OTPs of the same purpose for this user first,
  // so only the most recently issued code can ever be redeemed.
  await query(
    `UPDATE otp_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  );
  await query(
    `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, codeHash, purpose, expiresAt, req?.ip || null, req?.headers?.['user-agent'] || null]
  );
  return code;
}

/**
 * Wraps email sending so a broken SMTP configuration surfaces as a specific,
 * actionable 503 instead of the generic "Internal server error" — this is
 * the single most common cause of a confusing login failure, so it gets
 * its own clearly-labeled error path rather than falling through to the
 * catch-all error handler.
 */
async function issueOtpAndEmail({ user, req }) {
  const code = await issueOtp({ userId: user.id, purpose: 'LOGIN', req });
  try {
    return await sendOtpEmail({ to: user.email, name: user.full_name, code, purpose: 'LOGIN' });
  } catch (err) {
    const smtpError = new Error(
      'We could not send your verification email. Email delivery is not configured correctly — contact your administrator to check the SMTP settings.'
    );
    smtpError.status = 503;
    smtpError.originalMessage = err.message;
    throw smtpError;
  }
}

/**
 * STEP 1 — POST /api/auth/login
 * Verifies email + password. On success, does NOT log the user in yet —
 * it emails a one-time code and returns a short-lived loginTicket that
 * must be redeemed at /api/auth/verify-otp within 10 minutes. This applies
 * to every role (Admin, Heads, Referees, Players) with no exceptions.
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

      // Password correct — reset failed-attempt counter, then require OTP.
      await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

      const emailResult = await issueOtpAndEmail({ user, req });

      await recordAudit({ userId: user.id, action: 'OTP_ISSUED', entity: 'user', entityId: user.id, metadata: { purpose: 'LOGIN' }, req });

      res.json({
        otpRequired: true,
        loginTicket: signLoginTicket(user),
        maskedEmail: maskEmail(user.email),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        // Only present when SMTP isn't configured yet, purely so local/dev
        // testing works before you've set up a real mail provider. Remove
        // SMTP-less operation entirely before go-live.
        devOtp: emailResult.devFallback ? code : undefined,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * STEP 2 — POST /api/auth/verify-otp
 * Redeems the loginTicket + emailed code for real access/refresh tokens.
 */
router.post(
  '/verify-otp',
  otpVerifyLimiter,
  [body('loginTicket').isString().notEmpty(), body('code').isString().isLength({ min: 6, max: 6 })],
  validate,
  async (req, res, next) => {
    try {
      const { loginTicket, code } = req.body;
      let ticketPayload;
      try {
        ticketPayload = verifyLoginTicket(loginTicket);
      } catch {
        return res.status(401).json({ error: 'This login session has expired. Please log in again.' });
      }

      const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [ticketPayload.sub]);
      const user = userRows[0];
      if (!user) return res.status(401).json({ error: 'Account not found or deactivated.' });

      const { rows: otpRows } = await query(
        `SELECT * FROM otp_codes WHERE user_id = $1 AND purpose = 'LOGIN' AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [user.id]
      );
      const otp = otpRows[0];
      if (!otp || new Date(otp.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Code expired. Request a new one.' });
      }
      if (otp.attempts >= otp.max_attempts) {
        return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
      }

      if (!verifyOtpHash(code, otp.code_hash)) {
        await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
        await recordAudit({ userId: user.id, action: 'OTP_FAILED', entity: 'user', entityId: user.id, req });
        return res.status(401).json({ error: 'Incorrect code.' });
      }

      await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

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

/** POST /api/auth/resend-otp — issue a fresh code against an existing loginTicket. */
router.post('/resend-otp', otpResendLimiter, [body('loginTicket').isString().notEmpty()], validate, async (req, res, next) => {
  try {
    let ticketPayload;
    try {
      ticketPayload = verifyLoginTicket(req.body.loginTicket);
    } catch {
      return res.status(401).json({ error: 'This login session has expired. Please log in again.' });
    }
    const { rows } = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [ticketPayload.sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Account not found or deactivated.' });

    const emailResult = await issueOtpAndEmail({ user, req });
    await recordAudit({ userId: user.id, action: 'OTP_RESENT', entity: 'user', entityId: user.id, req });

    res.json({ sent: true, expiresInMinutes: OTP_EXPIRY_MINUTES, devOtp: emailResult.devFallback ? code : undefined });
  } catch (err) {
    next(err);
  }
});

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

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 3))}@${domain}`;
}

module.exports = router;
