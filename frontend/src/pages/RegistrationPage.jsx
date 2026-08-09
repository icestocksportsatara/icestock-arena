import { useEffect, useState } from 'react';
import client from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

export default function RegistrationPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teamForm, setTeamForm] = useState({ name: '', level: 'DISTRICT', category: 'MIXED' });
  const [playerForm, setPlayerForm] = useState({ fullName: '', teamId: '', dateOfBirth: '', gender: 'MALE', jerseyNumber: '' });
  const [tab, setTab] = useState('teams');
  const [error, setError] = useState(null);

  function loadTeams() { client.get('/teams').then((r) => setTeams(r.data.teams)); }
  function loadPlayers() { client.get('/players').then((r) => setPlayers(r.data.players)); }
  useEffect(() => { loadTeams(); loadPlayers(); }, []);

  async function submitTeam(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/teams', teamForm);
      setTeamForm({ name: '', level: 'DISTRICT', category: 'MIXED' });
      loadTeams();
    } catch (err) { setError(err.response?.data?.error || 'Could not register team.'); }
  }

  async function submitPlayer(e) {
    e.preventDefault();
    setError(null);
    try {
      await client.post('/players', { ...playerForm, jerseyNumber: playerForm.jerseyNumber ? Number(playerForm.jerseyNumber) : undefined, teamId: playerForm.teamId || undefined });
      setPlayerForm({ fullName: '', teamId: '', dateOfBirth: '', gender: 'MALE', jerseyNumber: '' });
      loadPlayers();
    } catch (err) { setError(err.response?.data?.error || 'Could not register player.'); }
  }

  return (
    <Layout>
      <p className="eyebrow">{user?.role?.replace('_', ' ')}</p>
      <h1 style={{ marginBottom: 8 }}>Team & Player Registration</h1>
      <p style={{ marginBottom: 20 }}>Registrations here are scoped automatically to your assigned jurisdiction.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`btn ${tab === 'teams' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('teams')}>Teams</button>
        <button className={`btn ${tab === 'players' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('players')}>Players</button>
      </div>

      {tab === 'teams' && (
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Register a team</h3>
            <form onSubmit={submitTeam}>
              <div className="field"><label>Team name</label><input required value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} /></div>
              <div className="field">
                <label>Level</label>
                <select value={teamForm.level} onChange={(e) => setTeamForm({ ...teamForm, level: e.target.value })}>
                  <option value="INTERNATIONAL">International</option>
                  <option value="NATIONAL">National</option>
                  <option value="STATE">State</option>
                  <option value="DISTRICT">District</option>
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select value={teamForm.category} onChange={(e) => setTeamForm({ ...teamForm, category: e.target.value })}>
                  {['MEN', 'WOMEN', 'MIXED', 'YOUTH_BOYS', 'YOUTH_GIRLS'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary">Register team</button>
            </form>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Registered teams</h3>
            <table>
              <thead><tr><th>Name</th><th>Level</th><th>Category</th></tr></thead>
              <tbody>{teams.map((t) => <tr key={t.id}><td style={{ fontFamily: 'var(--font-body)' }}>{t.name}</td><td>{t.level}</td><td>{t.category}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'players' && (
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Register a player</h3>
            <form onSubmit={submitPlayer}>
              <div className="field"><label>Full name</label><input required value={playerForm.fullName} onChange={(e) => setPlayerForm({ ...playerForm, fullName: e.target.value })} /></div>
              <div className="field">
                <label>Team (optional)</label>
                <select value={playerForm.teamId} onChange={(e) => setPlayerForm({ ...playerForm, teamId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="field"><label>Date of birth</label><input type="date" value={playerForm.dateOfBirth} onChange={(e) => setPlayerForm({ ...playerForm, dateOfBirth: e.target.value })} /></div>
                <div className="field"><label>Jersey #</label><input type="number" value={playerForm.jerseyNumber} onChange={(e) => setPlayerForm({ ...playerForm, jerseyNumber: e.target.value })} /></div>
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary">Register player</button>
            </form>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Registered players</h3>
            <table>
              <thead><tr><th>Name</th><th>Team</th></tr></thead>
              <tbody>{players.map((p) => <tr key={p.id}><td style={{ fontFamily: 'var(--font-body)' }}>{p.full_name}</td><td>{teams.find((t) => t.id === p.team_id)?.name || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
