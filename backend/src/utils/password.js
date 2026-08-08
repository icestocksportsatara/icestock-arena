const bcrypt = require('bcryptjs');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Minimum policy: 10+ chars, upper, lower, number, symbol.
 * Applied on registration/reset. Keep in sync with frontend validation.
 */
function isStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return false;
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  return hasUpper && hasLower && hasNumber && hasSymbol;
}

module.exports = { hashPassword, verifyPassword, isStrongPassword };
