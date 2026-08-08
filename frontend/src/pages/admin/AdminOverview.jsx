import { useEffect, useState } from 'react';
import client from '../../api/client';
import Layout from '../../components/Layout';

export default function AdminOverview() {
  const [counts, setCounts] = useState({ users: 0, tournaments: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [users, tournaments] = await Promise.all([
          client.get('/users'),
          client.get('/tournaments'),
        ]);
        setCounts({ users: users.data.users.length, tournaments: tournaments.data.tournaments.length });
      } catch {
        /* non-fatal for the overview */
      }
    })();
  }, []);

  return (
    <Layout>
      <p className="eyebrow">Super Admin</p>
      <h1 style={{ marginBottom: 24 }}>Platform Overview</h1>
      <div className="grid-3">
        <div className="card">
          <p className="eyebrow">Total logins</p>
          <h2>{counts.users}</h2>
        </div>
        <div className="card">
          <p className="eyebrow">Tournaments</p>
          <h2>{counts.tournaments}</h2>
        </div>
        <div className="card">
          <p className="eyebrow">Events supported</p>
          <h2>6</h2>
          <p style={{ fontSize: '0.8rem' }}>Team Game · Team Target · Team Distance · Individual Target · Individual Distance · Head to Head</p>
        </div>
      </div>
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 12 }}>As the sole super-admin account</h3>
        <p>You are the only account with full platform access. Use <strong>Manage Logins</strong> to create Country, State, and District Head accounts, and Referee accounts. Heads then register their own teams and players from their scoped dashboard.</p>
      </div>
    </Layout>
  );
}
