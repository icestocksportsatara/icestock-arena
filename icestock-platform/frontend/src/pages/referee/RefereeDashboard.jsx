import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import Layout from '../../components/Layout';

export default function RefereeDashboard() {
  const [matches, setMatches] = useState([]);

  useEffect(() => { client.get('/scoring/matches/mine').then((r) => setMatches(r.data.matches)); }, []);

  return (
    <Layout>
      <p className="eyebrow">Referee</p>
      <h1 style={{ marginBottom: 24 }}>My Assigned Matches</h1>
      <div className="card">
        <table>
          <thead><tr><th>Tournament</th><th>Event</th><th>Round</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id}>
                <td style={{ fontFamily: 'var(--font-body)' }}>{m.tournament_name}</td>
                <td>{m.event_type.replace(/_/g, ' ')}</td>
                <td>{m.round_name || '—'}</td>
                <td><span className={`badge badge-${m.status === 'LIVE' ? 'live' : m.status === 'COMPLETED' ? 'complete' : 'scheduled'}`}>{m.status}</span></td>
                <td><Link className="btn btn-outline" to={`/referee/matches/${m.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!matches.length && <p>No matches assigned to you yet.</p>}
      </div>
    </Layout>
  );
}
