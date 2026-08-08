import { useEffect, useState } from 'react';
import client from '../api/client';
import Layout from '../components/Layout';

const EVENT_TYPES = [
  { value: 'TEAM_GAME', label: 'Team Game' },
  { value: 'TEAM_TARGET', label: 'Team Target' },
  { value: 'TEAM_DISTANCE', label: 'Team Distance' },
  { value: 'INDIVIDUAL_TARGET', label: 'Individual Target' },
  { value: 'INDIVIDUAL_DISTANCE', label: 'Individual Distance' },
  { value: 'HEAD_TO_HEAD', label: 'Head to Head' },
];
const CATEGORIES = ['MEN', 'WOMEN', 'MIXED', 'YOUTH_BOYS', 'YOUTH_GIRLS'];

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [form, setForm] = useState({ name: '', level: 'DISTRICT', venue: '', startDate: '', endDate: '' });
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [category, setCategory] = useState('MIXED');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() { client.get('/tournaments').then((r) => setTournaments(r.data.tournaments)); }
  useEffect(load, []);

  function toggleEvent(value) {
    setSelectedEvents((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    if (!selectedEvents.length) return setError('Select at least one event.');
    setBusy(true);
    try {
      await client.post('/tournaments', {
        ...form,
        events: selectedEvents.map((eventType) => ({ eventType, category })),
      });
      setForm({ name: '', level: 'DISTRICT', venue: '', startDate: '', endDate: '' });
      setSelectedEvents([]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create tournament.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id, status) {
    await client.patch(`/tournaments/${id}/status`, { status });
    load();
  }

  return (
    <Layout>
      <p className="eyebrow">Tournament Management</p>
      <h1 style={{ marginBottom: 24 }}>Tournaments</h1>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Create a tournament</h3>
          <form onSubmit={handleCreate}>
            <div className="field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field">
              <label>Level</label>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                <option value="INTERNATIONAL">International</option>
                <option value="NATIONAL">National</option>
                <option value="STATE">State</option>
                <option value="DISTRICT">District</option>
              </select>
            </div>
            <div className="field"><label>Venue</label><input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></div>
            <div className="grid-2">
              <div className="field"><label>Start date</label><input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div className="field"><label>End date</label><input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Events (per IFI rules)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {EVENT_TYPES.map((ev) => (
                  <label key={ev.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={selectedEvents.includes(ev.value)} onChange={() => toggleEvent(ev.value)} />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create tournament'}</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>All tournaments</h3>
          {tournaments.map((t) => (
            <div key={t.id} className="card-light" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{t.name}</strong>
                  <p style={{ fontSize: '0.78rem', margin: '2px 0 0' }}>{t.level} · {t.start_date} — {t.end_date}</p>
                </div>
                <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} style={{ fontSize: '0.8rem' }}>
                  {['DRAFT', 'REGISTRATION_OPEN', 'ONGOING', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
          ))}
          {!tournaments.length && <p>No tournaments yet.</p>}
        </div>
      </div>
    </Layout>
  );
}
