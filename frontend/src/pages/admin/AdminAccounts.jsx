import { useEffect, useState } from 'react';
import client from '../../api/client';
import Layout from '../../components/Layout';

const ROLES = ['COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD', 'REFEREE', 'PLAYER'];

export default function AdminAccounts() {
  const [users, setUsers] = useState([]);
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [form, setForm] = useState({ fullName: '', email: '', role: 'REFEREE', countryId: '', stateId: '', districtId: '' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadUsers() {
    const { data } = await client.get('/users');
    setUsers(data.users);
  }

  useEffect(() => {
    loadUsers();
    client.get('/geo/countries').then((r) => setCountries(r.data.countries));
  }, []);

  useEffect(() => {
    if (form.countryId) client.get(`/geo/states?countryId=${form.countryId}`).then((r) => setStates(r.data.states));
    else setStates([]);
  }, [form.countryId]);

  useEffect(() => {
    if (form.stateId) client.get(`/geo/districts?stateId=${form.stateId}`).then((r) => setDistricts(r.data.districts));
    else setDistricts([]);
  }, [form.stateId]);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);
    try {
      const { data } = await client.post('/users', {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        countryId: form.countryId || undefined,
        stateId: form.stateId || undefined,
        districtId: form.districtId || undefined,
      });
      setCreated(data);
      setForm({ fullName: '', email: '', role: 'REFEREE', countryId: '', stateId: '', districtId: '' });
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user) {
    await client.patch(`/users/${user.id}/status`, { isActive: !user.is_active });
    loadUsers();
  }

  return (
    <Layout>
      <p className="eyebrow">Super Admin</p>
      <h1 style={{ marginBottom: 24 }}>Manage Logins</h1>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Create a login</h3>
          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Full name</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
            {['COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'].includes(form.role) && (
              <div className="field">
                <label>Country</label>
                <select required value={form.countryId} onChange={(e) => setForm({ ...form, countryId: e.target.value, stateId: '', districtId: '' })}>
                  <option value="">Select a country</option>
                  {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {['STATE_HEAD', 'DISTRICT_HEAD'].includes(form.role) && (
              <div className="field">
                <label>State</label>
                <select required value={form.stateId} onChange={(e) => setForm({ ...form, stateId: e.target.value, districtId: '' })}>
                  <option value="">Select a state</option>
                  {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {form.role === 'DISTRICT_HEAD' && (
              <div className="field">
                <label>District</label>
                <select required value={form.districtId} onChange={(e) => setForm({ ...form, districtId: e.target.value })}>
                  <option value="">Select a district</option>
                  {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
          </form>

          {created && (
            <div className="card-light" style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Account created</p>
              <p className="mono" style={{ fontSize: '0.85rem' }}>Email: {created.user.email}</p>
              <p className="mono" style={{ fontSize: '0.85rem' }}>Temp password: {created.tempPassword}</p>
              <p style={{ fontSize: '0.78rem', marginTop: 8 }}>Share this password with the user through a secure channel. They'll be required to change it on first login.</p>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>All logins</h3>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: 'var(--font-body)' }}>{u.full_name}<br /><span style={{ fontSize: '0.75rem', color: 'var(--frost-dim)' }}>{u.email}</span></td>
                    <td>{u.role.replace('_', ' ')}</td>
                    <td><span className={`badge ${u.is_active ? 'badge-complete' : 'badge-scheduled'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                    <td><button className="btn btn-ghost" onClick={() => toggleActive(u)}>{u.is_active ? 'Disable' : 'Enable'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
