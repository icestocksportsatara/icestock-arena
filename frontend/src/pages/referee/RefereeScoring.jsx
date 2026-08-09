import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import client, { getTokens } from '../../api/client';
import Layout from '../../components/Layout';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export default function RefereeScoring() {
  const { matchId } = useParams();
  const [live, setLive] = useState(null);
  const [scorecards, setScorecards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const { data } = await client.get(`/scoring/matches/${matchId}/live`);
    setLive(data);
    const sc = await client.get(`/scorecards/matches/${matchId}`);
    setScorecards(sc.data.scorecards);
  }, [matchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const { accessToken } = getTokens();
    const socket = io(SOCKET_URL, { auth: { token: accessToken } });
    socket.emit('match:join', matchId);
    socket.on('score:update', load);
    socket.on('match:finalized', load);
    return () => socket.disconnect();
  }, [matchId, load]);

  async function startMatch() {
    await client.post(`/scoring/matches/${matchId}/start`);
    load();
  }

  async function finalize() {
    setBusy(true);
    setMsg(null);
    try {
      await client.post(`/scoring/matches/${matchId}/finalize`);
      setMsg({ type: 'ok', text: 'Match finalized. Result locked.' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Could not finalize match.' });
    } finally {
      setBusy(false);
    }
  }

  async function generateScorecard() {
    setBusy(true);
    setMsg(null);
    try {
      await client.post(`/scorecards/matches/${matchId}`);
      setMsg({ type: 'ok', text: 'Scorecard PDF generated.' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Could not generate scorecard.' });
    } finally {
      setBusy(false);
    }
  }

  if (!live) return <Layout><p>Loading match…</p></Layout>;

  const { match, eventType } = live;

  return (
    <Layout>
      <p className="eyebrow">Referee · {eventType.replace(/_/g, ' ')}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Live Scoring</h1>
        <span className={`badge badge-${match.status === 'LIVE' ? 'live' : match.status === 'COMPLETED' ? 'complete' : 'scheduled'}`}>{match.status}</span>
      </div>

      {match.status === 'SCHEDULED' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p style={{ marginBottom: 12 }}>Match has not started yet.</p>
          <button className="btn btn-primary" onClick={startMatch}>Start match</button>
        </div>
      )}

      {match.status !== 'SCHEDULED' && (
        <>
          {eventType === 'TEAM_GAME' && <TeamGameForm matchId={matchId} onSaved={load} disabled={match.status === 'COMPLETED'} />}
          {['TEAM_TARGET', 'INDIVIDUAL_TARGET'].includes(eventType) && <TargetForm matchId={matchId} onSaved={load} disabled={match.status === 'COMPLETED'} isTeam={eventType === 'TEAM_TARGET'} />}
          {['TEAM_DISTANCE', 'INDIVIDUAL_DISTANCE'].includes(eventType) && <DistanceForm matchId={matchId} onSaved={load} disabled={match.status === 'COMPLETED'} isTeam={eventType === 'TEAM_DISTANCE'} />}
          {eventType === 'HEAD_TO_HEAD' && <HeadToHeadForm matchId={matchId} onSaved={load} disabled={match.status === 'COMPLETED'} />}

          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 12 }}>Raw entries logged</h3>
            <pre className="mono" style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'var(--frost-dim)' }}>
              {JSON.stringify(live.rawEntries, null, 2)}
            </pre>
          </div>

          {msg && <p className={msg.type === 'error' ? 'error-text' : ''} style={{ color: msg.type === 'ok' ? 'var(--success)' : undefined, margin: '16px 0' }}>{msg.text}</p>}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            {match.status !== 'COMPLETED' && <button className="btn btn-primary" disabled={busy} onClick={finalize}>Finalize match</button>}
            {match.status === 'COMPLETED' && <button className="btn btn-outline" disabled={busy} onClick={generateScorecard}>Generate scorecard PDF</button>}
          </div>

          {match.result && (
            <div className="card" style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 12 }}>Final Result</h3>
              <pre className="mono" style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{JSON.stringify(match.result, null, 2)}</pre>
            </div>
          )}

          {scorecards.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 12 }}>Scorecards</h3>
              {scorecards.map((sc) => (
                <a key={sc.id} className="btn btn-outline" style={{ marginRight: 8 }} href={`${client.defaults.baseURL}/scorecards/${sc.id}/download`} target="_blank" rel="noreferrer">
                  Download PDF ({new Date(sc.generated_at).toLocaleString()})
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function TeamGameForm({ matchId, onSaved, disabled }) {
  const [turn, setTurn] = useState({ turnNumber: 1, teamAPoints: 0, teamBPoints: 0 });
  async function submit(e) {
    e.preventDefault();
    await client.post(`/scoring/matches/${matchId}/team-game/turn`, turn);
    setTurn({ ...turn, turnNumber: Math.min(6, turn.turnNumber + 1) });
    onSaved();
  }
  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Team Game — Turn Entry (6 turns, 0–4 pts each side)</h3>
      <form onSubmit={submit} className="grid-3">
        <div className="field"><label>Turn #</label><input type="number" min={1} max={6} value={turn.turnNumber} onChange={(e) => setTurn({ ...turn, turnNumber: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Team A points</label><input type="number" min={0} max={4} value={turn.teamAPoints} onChange={(e) => setTurn({ ...turn, teamAPoints: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Team B points</label><input type="number" min={0} max={4} value={turn.teamBPoints} onChange={(e) => setTurn({ ...turn, teamBPoints: Number(e.target.value) })} disabled={disabled} /></div>
        <button className="btn btn-primary" disabled={disabled}>Save turn</button>
      </form>
    </div>
  );
}

function TargetForm({ matchId, onSaved, disabled, isTeam }) {
  const [attempt, setAttempt] = useState({ roundNumber: 1, attemptNumber: 1, pointsScored: 0, participantId: '', scenarioCode: '' });
  async function submit(e) {
    e.preventDefault();
    const payload = {
      roundNumber: attempt.roundNumber,
      attemptNumber: attempt.attemptNumber,
      pointsScored: attempt.pointsScored,
      scenarioCode: attempt.scenarioCode || undefined,
      ...(isTeam ? { participantTeamId: attempt.participantId } : { participantPlayerId: attempt.participantId }),
    };
    await client.post(`/scoring/matches/${matchId}/target/attempt`, payload);
    setAttempt({ ...attempt, attemptNumber: attempt.attemptNumber < 6 ? attempt.attemptNumber + 1 : 1, roundNumber: attempt.attemptNumber === 6 ? Math.min(4, attempt.roundNumber + 1) : attempt.roundNumber });
    onSaved();
  }
  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Target Competition — 4 rounds × 6 attempts</h3>
      <p style={{ marginBottom: 12 }}>Round 1: ring score (2/4/6/8/10). Rounds 2–4: scenario points per your tournament's format config.</p>
      <form onSubmit={submit} className="grid-3">
        <div className="field"><label>{isTeam ? 'Team ID' : 'Player ID'}</label><input required value={attempt.participantId} onChange={(e) => setAttempt({ ...attempt, participantId: e.target.value })} disabled={disabled} /></div>
        <div className="field"><label>Round (1–4)</label><input type="number" min={1} max={4} value={attempt.roundNumber} onChange={(e) => setAttempt({ ...attempt, roundNumber: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Attempt (1–6)</label><input type="number" min={1} max={6} value={attempt.attemptNumber} onChange={(e) => setAttempt({ ...attempt, attemptNumber: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Points scored</label><input type="number" min={0} max={10} value={attempt.pointsScored} onChange={(e) => setAttempt({ ...attempt, pointsScored: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Scenario code (rounds 2–4)</label><input placeholder="OWN_STAYS_OPP_OUT" value={attempt.scenarioCode} onChange={(e) => setAttempt({ ...attempt, scenarioCode: e.target.value })} disabled={disabled} /></div>
        <button className="btn btn-primary" disabled={disabled} style={{ alignSelf: 'end' }}>Save attempt</button>
      </form>
    </div>
  );
}

function DistanceForm({ matchId, onSaved, disabled, isTeam }) {
  const [attempt, setAttempt] = useState({ attemptNumber: 1, distanceM: '', participantId: '', isFault: false });
  async function submit(e) {
    e.preventDefault();
    const payload = {
      attemptNumber: attempt.attemptNumber,
      distanceM: Number(attempt.distanceM),
      isFault: attempt.isFault,
      ...(isTeam ? { participantTeamId: attempt.participantId } : { participantPlayerId: attempt.participantId }),
    };
    await client.post(`/scoring/matches/${matchId}/distance/attempt`, payload);
    setAttempt({ ...attempt, attemptNumber: attempt.attemptNumber + 1, distanceM: '' });
    onSaved();
  }
  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Distance Competition — attempts measured in meters</h3>
      <form onSubmit={submit} className="grid-3">
        <div className="field"><label>{isTeam ? 'Team ID' : 'Player ID'}</label><input required value={attempt.participantId} onChange={(e) => setAttempt({ ...attempt, participantId: e.target.value })} disabled={disabled} /></div>
        <div className="field"><label>Attempt #</label><input type="number" min={1} value={attempt.attemptNumber} onChange={(e) => setAttempt({ ...attempt, attemptNumber: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>Distance (m)</label><input type="number" step="0.01" min={0} required value={attempt.distanceM} onChange={(e) => setAttempt({ ...attempt, distanceM: e.target.value })} disabled={disabled} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={attempt.isFault} onChange={(e) => setAttempt({ ...attempt, isFault: e.target.checked })} disabled={disabled} /> Fault (left lane)
        </label>
        <button className="btn btn-primary" disabled={disabled}>Save attempt</button>
      </form>
    </div>
  );
}

function HeadToHeadForm({ matchId, onSaved, disabled }) {
  const [round, setRound] = useState({ roundNumber: 1, playerARoundPoints: 0, playerBRoundPoints: 0, playerARawScore: 0, playerBRawScore: 0 });
  async function submit(e) {
    e.preventDefault();
    await client.post(`/scoring/matches/${matchId}/head-to-head/round`, round);
    setRound({ ...round, roundNumber: round.roundNumber + 1 });
    onSaved();
  }
  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Head to Head — knockout duel</h3>
      <p style={{ marginBottom: 12 }}>4 alternating attempts per round. First to 7 game points wins; ties settled on total raw score.</p>
      <form onSubmit={submit} className="grid-3">
        <div className="field"><label>Round #</label><input type="number" min={1} value={round.roundNumber} onChange={(e) => setRound({ ...round, roundNumber: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>A round points</label><input type="number" min={0} value={round.playerARoundPoints} onChange={(e) => setRound({ ...round, playerARoundPoints: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>B round points</label><input type="number" min={0} value={round.playerBRoundPoints} onChange={(e) => setRound({ ...round, playerBRoundPoints: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>A raw score</label><input type="number" min={0} value={round.playerARawScore} onChange={(e) => setRound({ ...round, playerARawScore: Number(e.target.value) })} disabled={disabled} /></div>
        <div className="field"><label>B raw score</label><input type="number" min={0} value={round.playerBRawScore} onChange={(e) => setRound({ ...round, playerBRawScore: Number(e.target.value) })} disabled={disabled} /></div>
        <button className="btn btn-primary" disabled={disabled}>Save round</button>
      </form>
    </div>
  );
}
