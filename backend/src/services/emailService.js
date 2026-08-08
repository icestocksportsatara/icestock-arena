const nodemailer = require('nodemailer');

// Brevo (Sendinblue) SMTP relay — port 587 uses STARTTLS, so secure MUST be false.
// If SMTP_HOST is not set, we skip real email (dev fallback) — the login route
// should already handle that by returning devOtp instead of calling this.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp-relay.brevo.com
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,                        // false for port 587 (STARTTLS), true only for port 465
  auth: {
    user: process.env.SMTP_USER,        // your Brevo login email
    pass: process.env.SMTP_PASSWORD,    // your Brevo SMTP key (not your Brevo account password)
  },
  connectionTimeout: 15000,             // fail fast (15s) instead of hanging for minutes
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

// Optional but very useful: verify the connection once at server startup so
// you see a clear error in Render logs immediately, instead of only on login.
transporter.verify((err) => {
  if (err) {
    console.error('SMTP verify failed:', err.message);
  } else {
    console.log('SMTP connection verified — ready to send emails.');
  }
});

async function sendOtpEmail(toEmail, otpCode) {
  if (!process.env.SMTP_HOST) {
    // Dev fallback — should be handled by the caller (login route), this is a safety net.
    console.log(`[DEV OTP] ${toEmail}: ${otpCode}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Icestock Arena" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Your Icestock Arena login code',
    text: `Your one-time login code is ${otpCode}. It expires in 10 minutes.`,
    html: `<p>Your one-time login code is <b>${otpCode}</b>.</p><p>It expires in 10 minutes.</p>`,
  });
}

module.exports = { sendOtpEmail, transporter };
