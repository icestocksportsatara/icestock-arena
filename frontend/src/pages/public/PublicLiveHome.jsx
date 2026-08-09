import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import IcestockHero3D from '../../components/IcestockHero3D';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function PublicLiveHome() {
  const [tournaments, setTournaments] = useState([]);

  useEffect(() => {
    axios.get(`${API_URL}/public/tournaments`).then((r) => setTournaments(r.data.tournaments));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--frost)' }}>
      <header style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--ink-line)' }}>
        <div className="brand">
          <svg className="brand-rings" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="16" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="11" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="6" fill="none" stroke="#FF7A45" strokeWidth="1.5" />
            <circle cx="17" cy="17" r="1.8" fill="#FF7A45" />
          </svg>
          <span className="brand-name">ICESTOCK ARENA — LIVE</span>
        </div>
        <Link className="btn btn-outline" to="/login">Sign in</Link>
      </header>

      <main style={{ padding: '32px', maxWidth: 900, margin: '0 auto' }}>
        <div className="card" style={{ padding: 0, marginBottom: 32, overflow: 'hidden' }}>
          <IcestockHero3D height={420} />
          <div style={{ padding: '24px 28px' }}>
            <h1 style={{ marginBottom: 8 }}>The official home of Icestock Sport scoring</h1>
            <p style={{ margin: 0 }}>Team Game · Team Target · Team Distance · Individual Target · Individual Distance · Head to Head — scored live, per IFI rules, at International, National, State, and District level.</p>
          </div>
        </div>

        <p className="eyebrow">Public scoreboard · no login required</p>
        <h2 style={{ marginBottom: 24 }}>Live & Upcoming Tournaments</h2>

        {tournaments.map((t) => (
          <Link key={t.id} to={`/live/${t.id}`} className="card" style={{ display: 'block', marginBottom: 16, textDecoration: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ color: 'var(--frost)' }}>{t.name}</h3>
                <p style={{ margin: '4px 0 0' }}>{t.level} · {t.venue || 'Venue TBD'} · {t.start_date} — {t.end_date}</p>
              </div>
              <span className={`badge ${t.status === 'ONGOING' ? 'badge-live' : 'badge-scheduled'}`}>{t.status.replace('_', ' ')}</span>
            </div>
          </Link>
        ))}
        {!tournaments.length && <p>No tournaments are live right now — check back during an event.</p>}
      </main>
    </div>
  );
}
