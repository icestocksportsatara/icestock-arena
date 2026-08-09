const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null; // not configured — see fallback in sendOtpEmail

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return transporter;
}

/**
 * Sends the OTP code by email. If SMTP isn't configured (e.g. local dev,
 * or before you've set up a mail provider), the code is written to the
 * server log instead so the login flow still works end-to-end — but this
 * MUST be replaced with a real SMTP provider before going live, since
 * logging OTPs is not acceptable in production.
 */
async function sendOtpEmail({ to, name, code, purpose }) {
  const subject = purpose === 'PASSWORD_RESET'
    ? 'Icestock Arena — Password reset code'
    : 'Icestock Arena — Your login verification code';

  const text = `Hi ${name || ''},

Your one-time verification code is: ${code}

This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes and can only be used once.
If you did not request this, you can safely ignore this email — do not share this code with anyone, including anyone claiming to be from Icestock Arena support.`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      <div style="background:#0B1B2B;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="color:#EAF6FB;margin:0;">ICESTOCK ARENA</h2>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p>Hi ${name || ''},</p>
        <p>Your one-time verification code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0B1B2B;">${code}</p>
        <p style="color:#666;font-size:13px;">This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes and can only be used once. Never share this code with anyone.</p>
      </div>
    </div>`;

  const t = getTransporter();
  if (!t) {
    // Development fallback only — see warning above.
    logger.warn('SMTP not configured — logging OTP instead of emailing it. Set SMTP_HOST etc. before production.', {
      to,
      code,
      purpose,
    });
    return { delivered: false, devFallback: true };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || '"Icestock Arena" <no-reply@icestock.local>',
    to,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

module.exports = { sendOtpEmail };
