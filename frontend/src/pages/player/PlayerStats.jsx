import { useEffect, useState } from 'react';
import client from '../../api/client';
import Layout from '../../components/Layout';

export default function PlayerStats() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    client.get('/stats/me').then((r) => setData(r.data)).catch((err) => setError(err.response?.data?.error || 'Could not load stats.'));
  }
  useEffect(load, []);

  async function upgrade(plan) {
    setBusy(true);
    try {
      await client.post('/subscriptions', { plan });
      load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Layout><div className="card"><p>{error}</p></div></Layout>;
  if (!data) return <Layout><p>Loading…</p></Layout>;

  const { player, subscription, basicStats, advancedStats } = data;

  return (
    <Layout>
      <p className="eyebrow">Player</p>
      <h1 style={{ marginBottom: 8 }}>{player.full_name}</h1>
      <p style={{ marginBottom: 24 }}>Plan: <strong style={{ color: 'var(--ice)' }}>{subscription.plan}</strong></p>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="eyebrow">Matches played</p>
          <h2>{basicStats.totalMatches}</h2>
        </div>
        <div className="card">
          <p className="eyebrow">Subscription</p>
          <h2>{subscription.plan}</h2>
        </div>
        <div className="card">
          <p className="eyebrow">Potential rating</p>
          <h2>{advancedStats ? `${advancedStats.potentialRating}/100` : '🔒'}</h2>
        </div>
      </div>

      {advancedStats ? (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Advanced analytics</h3>
          <div className="grid-3">
            <Stat label="Target avg pts / attempt" value={advancedStats.targetAvgPointsPerAttempt} />
            <Stat label="Distance avg (m)" value={advancedStats.distanceAvgMeters} />
            <Stat label="Distance best (m)" value={advancedStats.distanceBestMeters} />
            <Stat label="Consistency index (lower = steadier)" value={advancedStats.consistencyIndex} />
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Unlock advanced analytics</h3>
          <p style={{ marginBottom: 16 }}>Upgrade to PRO or ELITE to see attempt-by-attempt breakdowns, consistency trends, and your potential rating.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => upgrade('PRO')}>Upgrade to PRO</button>
            <button className="btn btn-outline" disabled={busy} onClick={() => upgrade('ELITE')}>Upgrade to ELITE</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent matches</h3>
        <table>
          <thead><tr><th>Event</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>
            {data.recentMatches.map((m) => (
              <tr key={m.id}>
                <td>{m.event_type.replace(/_/g, ' ')}</td>
                <td><span className={`badge badge-${m.status === 'COMPLETED' ? 'complete' : 'scheduled'}`}>{m.status}</span></td>
                <td style={{ fontSize: '0.75rem' }}>{m.result ? m.result.winner : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
    </div>
  );
}
