const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../config/db');

/**
 * Requires a valid, non-expired access token. Attaches req.user with the
 * current DB state (not just the token claims) so a deactivated account
 * is rejected immediately even if the token hasn't expired yet.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const { rows } = await query(
      `SELECT id, full_name, email, role, country_id, state_id, district_id,
              is_active, locked_until
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account not found or deactivated.' });
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked.' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
