import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_HOME = {
  SUPER_ADMIN: '/admin',
  COUNTRY_HEAD: '/registration',
  STATE_HEAD: '/registration',
  DISTRICT_HEAD: '/registration',
  REFEREE: '/referee',
  PLAYER: '/player',
};

function BrandMark() {
  return (
    <div className="brand" style={{ marginBottom: 24 }}>
      <svg className="brand-rings" viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="16" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="11" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="6" fill="none" stroke="#FF7A45" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="1.8" fill="#FF7A45" />
      </svg>
      <span className="brand-name">ICESTOCK ARENA</span>
    </div>
  );
}

export default function LoginPage() {
  const { login, verifyOtp, resendOtp, cancelOtp, otpChallenge, error, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resendMsg, setResendMsg] = useState(null);
  const navigate = useNavigate();

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    try {
      await login(email, password);
    } catch {
      /* error surfaced via context */
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    try {
      const user = await verifyOtp(code);
      if (user.mustChangePassword) navigate('/change-password');
      else navigate(ROLE_HOME[user.role] || '/');
    } catch {
      /* error surfaced via context */
    }
  }

  async function handleResend() {
    setResendMsg(null);
    try {
      await resendOtp();
      setResendMsg('A new code has been sent.');
    } catch {
      setResendMsg('Could not resend code — try again shortly.');
    }
  }

  if (otpChallenge) {
    return (
      <div className="auth-page">
        <div className="auth-card card">
          <BrandMark />
          <p className="eyebrow" style={{ marginBottom: 8 }}>Step 2 of 2 — Verify it's you</p>
          <h2 style={{ marginBottom: 8 }}>Enter your code</h2>
          <p style={{ marginBottom: 20 }}>
            We sent a 6-digit code to <strong style={{ color: 'var(--ice)' }}>{otpChallenge.maskedEmail}</strong>. It expires in {otpChallenge.expiresInMinutes} minutes.
          </p>

          {otpChallenge.devOtp && (
            <div className="card-light" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 700 }}>Development mode — email not configured</p>
              <p className="mono" style={{ fontSize: '1.1rem' }}>{otpChallenge.devOtp}</p>
            </div>
          )}

          <form onSubmit={handleOtpSubmit}>
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input
                id="code"
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ letterSpacing: '0.4em', fontFamily: 'var(--font-mono)', fontSize: '1.2rem', textAlign: 'center' }}
              />
            </div>
            {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}
            <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={loading || code.length !== 6}>
              {loading ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={cancelOtp} type="button">← Back</button>
            <button className="btn btn-ghost" onClick={handleResend} type="button">Resend code</button>
          </div>
          {resendMsg && <p style={{ fontSize: '0.8rem', marginTop: 8 }}>{resendMsg}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <BrandMark />
        <p className="eyebrow" style={{ marginBottom: 8 }}>Step 1 of 2 — Sign in</p>
        <h2 style={{ marginBottom: 20 }}>Tournament & Scoring Platform</h2>
        <form onSubmit={handlePasswordSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={loading}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: '0.8rem' }}>
          Every login is protected by a one-time code sent to your email, in addition to your password. Accounts are created by your federation administrator.
        </p>
      </div>
    </div>
  );
}
