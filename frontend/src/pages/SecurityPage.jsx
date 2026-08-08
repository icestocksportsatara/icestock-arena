import { useEffect, useState } from 'react';
import client, { clearTokens } from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function SecurityPage() {
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  function load() {
    client.get('/auth/sessions').then((r) => setSessions(r.data.sessions));
  }
  useEffect(load, []);

  async function revoke(id) {
    await client.post(`/auth/sessions/${id}/revoke`);
    load();
  }

  async function revokeAll() {
    setBusy(true);
    try {
      await client.post('/auth/sessions/revoke-all');
      clearTokens();
      setUser(null);
      navigate('/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <p className="eyebrow">Account Security</p>
      <h1 style={{ marginBottom: 8 }}>Sessions & Devices</h1>
      <p style={{ marginBottom: 24 }}>
        Every login to your account requires your password plus a one-time code sent to your email.
        This list shows every device that's currently signed in — revoke anything you don't recognize.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Device / Browser</th><th>IP address</th><th>Signed in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', maxWidth: 260 }}>{s.user_agent || 'Unknown device'}</td>
                <td>{s.ip_address || '—'}</td>
                <td style={{ fontSize: '0.78rem' }}>{new Date(s.created_at).toLocaleString()}</td>
                <td><span className={`badge ${s.active ? 'badge-live' : 'badge-scheduled'}`}>{s.active ? 'Active' : 'Signed out'}</span></td>
                <td>{s.active && <button className="btn btn-ghost" onClick={() => revoke(s.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sessions.length && <p>No session history yet.</p>}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Suspect something's wrong?</h3>
        <p style={{ marginBottom: 16 }}>Sign out of every device at once — you'll need your password and a fresh code to sign back in anywhere.</p>
        <button className="btn btn-danger" disabled={busy} onClick={revokeAll}>Sign out everywhere</button>
      </div>
    </Layout>
  );
}
