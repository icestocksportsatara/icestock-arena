import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await client.post('/auth/change-password', { currentPassword, newPassword });
      const updated = { ...user, mustChangePassword: false };
      localStorage.setItem('icestock_user', JSON.stringify(updated));
      setUser(updated);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Security</p>
        <h2 style={{ marginBottom: 8 }}>Set a new password</h2>
        <p style={{ marginBottom: 20 }}>This account was created by an administrator with a temporary password. Choose a new one to continue.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Temporary / current password</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <p style={{ fontSize: '0.78rem', marginBottom: 12 }}>10+ characters, with upper case, lower case, a number, and a symbol.</p>
          {error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
