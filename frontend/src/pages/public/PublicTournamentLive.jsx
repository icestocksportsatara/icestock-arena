import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function PublicTournamentLive() {
  const { tournamentId } = useParams();
  const [data, setData] = useState(null);
  const [matchesByEvent, setMatchesByEvent] = useState({});

  useEffect(() => {
    axios.get(`${API_URL}/public/tournaments/${tournamentId}`).then((r) => setData(r.data));
  }, [tournamentId]);

  useEffect(() => {
    if (!data) return;
    data.events.forEach((ev) => {
      axios.get(`${API_URL}/public/events/${ev.id}/matches`).then((r) =>
        setMatchesByEvent((prev) => ({ ...prev, [ev.id]: r.data.matches }))
      );
    });
    const interval = setInterval(() => {
      data.events.forEach((ev) => {
        axios.get(`${API_URL}/public/events/${ev.id}/matches`).then((r) =>
          setMatchesByEvent((prev) => ({ ...prev, [ev.id]: r.data.matches }))
        );
      });
    }, 8000); // simple polling refresh for the public board
    return () => clearInterval(interval);
  }, [data]);

  if (!data) return <div style={{ padding: 32, color: 'var(--frost)', background: 'var(--ink)', minHeight: '100vh' }}>Loading…</div>;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--frost)' }}>
      <header style={{ padding: '20px 32px', borderBottom: '1px solid var(--ink-line)' }}>
        <Link to="/live" style={{ fontSize: '0.8rem' }}>← All tournaments</Link>
        <h1 style={{ marginTop: 8 }}>{data.tournament.name}</h1>
        <p>{data.tournament.level} · {data.tournament.venue || 'Venue TBD'}</p>
      </header>

      <main style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
        {data.events.map((ev) => (
          <section key={ev.id} style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 12 }}>{ev.event_type.replace(/_/g, ' ')} — {ev.category}</h3>
            <div className="grid-2">
              {(matchesByEvent[ev.id] || []).map((m) => (
                <div key={m.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className={`badge ${m.status === 'LIVE' ? 'badge-live' : m.status === 'COMPLETED' ? 'badge-complete' : 'badge-scheduled'}`}>{m.status}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--frost-dim)' }}>{m.round_name || ''}</span>
                  </div>
                  <p style={{ fontFamily: 'var(--font-mono)' }}>
                    {m.team_a_name || m.player_a_name || 'TBD'} <span style={{ color: 'var(--signal)' }}>vs</span> {m.team_b_name || m.player_b_name || 'TBD'}
                  </p>
                  {m.result && (
                    <pre className="mono" style={{ fontSize: '0.75rem', marginTop: 8, color: 'var(--frost-dim)', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(m.result, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
              {!matchesByEvent[ev.id]?.length && <p>No matches scheduled yet for this event.</p>}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
