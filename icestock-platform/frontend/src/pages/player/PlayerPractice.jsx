import { useEffect, useState } from 'react';
import client from '../../api/client';
import Layout from '../../components/Layout';

const EVENTS = ['TEAM_GAME', 'TEAM_TARGET', 'TEAM_DISTANCE', 'INDIVIDUAL_TARGET', 'INDIVIDUAL_DISTANCE', 'HEAD_TO_HEAD'];

export default function PlayerPractice() {
  const [eventType, setEventType] = useState('INDIVIDUAL_TARGET');
  const [attempts, setAttempts] = useState([]);
  const [current, setCurrent] = useState('');
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);

  function load() { client.get('/stats/practice').then((r) => setSessions(r.data.sessions)); }
  useEffect(load, []);

  const isTarget = eventType.includes('TARGET');
  const isDistance = eventType.includes('DISTANCE');

  function addAttempt() {
    if (current === '') return;
    setAttempts([...attempts, Number(current)]);
    setCurrent('');
  }

  function total() {
    if (isTarget) return attempts.reduce((s, v) => s + v, 0);
    if (isDistance) return attempts.reduce((s, v) => s + v, 0); // raw meters sum, illustrative
    return attempts.reduce((s, v) => s + v, 0);
  }

  async function saveSession() {
    setSaving(true);
    try {
      await client.post('/stats/practice', {
        eventType,
        sessionData: { attempts },
        totalScore: total(),
      });
      setAttempts([]);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <p className="eyebrow">Player</p>
      <h1 style={{ marginBottom: 24 }}>Practice Mode</h1>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Log a practice session</h3>
          <div className="field">
            <label>Event</label>
            <select value={eventType} onChange={(e) => { setEventType(e.target.value); setAttempts([]); }}>
              {EVENTS.map((e) => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{isDistance ? 'Distance (m) for this attempt' : 'Points for this attempt'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <button type="button" className="btn btn-outline" onClick={addAttempt}>Add</button>
            </div>
          </div>
          <p style={{ marginBottom: 16 }}>Attempts logged: {attempts.length} — running total: <strong className="mono">{total()}</strong></p>
          <button className="btn btn-primary" disabled={!attempts.length || saving} onClick={saveSession}>
            {saving ? 'Saving…' : 'Save session'}
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Recent sessions</h3>
          <table>
            <thead><tr><th>Event</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.event_type.replace(/_/g, ' ')}</td>
                  <td>{s.total_score}</td>
                  <td style={{ fontSize: '0.75rem' }}>{new Date(s.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sessions.length && <p>No practice sessions logged yet.</p>}
        </div>
      </div>
    </Layout>
  );
}
