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

export default function LoginPage() {
  const { login, error, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const user = await login(email, password);
      if (user.mustChangePassword) navigate('/change-password');
      else navigate(ROLE_HOME[user.role] || '/');
    } catch {
      /* error surfaced via context */
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="brand" style={{ marginBottom: 24 }}>
          <svg className="brand-rings" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="16" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="11" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="6" fill="none" stroke="#FF7A45" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="1.8" fill="#FF7A45" />
          </svg>
          <span className="brand-name">ICESTOCK ARENA</span>
        </div>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Sign in</p>
        <h2 style={{ marginBottom: 20 }}>Tournament & Scoring Platform</h2>
        <form onSubmit={handleSubmit}>
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: '0.8rem' }}>
          Accounts are created by your federation administrator. Contact your Country, State, or District Head if you need access.
        </p>
      </div>
    </div>
  );
}
