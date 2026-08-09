const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      countryId: user.country_id,
      stateId: user.state_id,
      districtId: user.district_id,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m', issuer: 'icestock-platform' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d', issuer: 'icestock-platform' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

/** Store only a hash of the refresh token server-side so a DB leak alone
 *  doesn't hand out valid tokens. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Short-lived "login ticket" issued after password verification succeeds,
 * before OTP verification. It carries no session privileges by itself —
 * it can only be redeemed at /auth/verify-otp, and only within its 10
 * minute window, which limits the blast radius if it ever leaked.
 */
function signLoginTicket(user) {
  return jwt.sign(
    { sub: user.id, type: 'login_ticket' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '10m', issuer: 'icestock-platform' }
  );
}

function verifyLoginTicket(token) {
  const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  if (payload.type !== 'login_ticket') throw new Error('Invalid ticket type.');
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signLoginTicket,
  verifyLoginTicket,
  hashToken,
};
