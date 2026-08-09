const crypto = require('crypto');

/** 6-digit numeric OTP — generated with a CSPRNG, not Math.random(). */
function generateOtpCode() {
  const n = crypto.randomInt(0, 1000000);
  return n.toString().padStart(6, '0');
}

/**
 * OTPs are short-lived (minutes) and rate-limited at the DB level
 * (max_attempts) and at the route level (express-rate-limit), so a fast
 * salted hash is appropriate here — unlike account passwords, which use
 * bcrypt. We still never store the code in plaintext.
 */
function hashOtp(code) {
  const pepper = process.env.JWT_ACCESS_SECRET || 'fallback-pepper';
  return crypto.createHmac('sha256', pepper).update(code).digest('hex');
}

function verifyOtpHash(code, hash) {
  const computed = hashOtp(code);
  // Constant-time comparison to avoid timing side-channels.
  const a = Buffer.from(computed);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateOtpCode, hashOtp, verifyOtpHash };
