import { useEffect, useState } from 'react';
import client from '../../api/client';
import Layout from '../../components/Layout';

export default function AdminGeography() {
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [newCountry, setNewCountry] = useState({ name: '', isoCode: '' });
  const [newState, setNewState] = useState('');
  const [newDistrict, setNewDistrict] = useState('');

  function loadCountries() { client.get('/geo/countries').then((r) => setCountries(r.data.countries)); }
  useEffect(loadCountries, []);
  useEffect(() => {
    if (selectedCountry) client.get(`/geo/states?countryId=${selectedCountry}`).then((r) => setStates(r.data.states));
    else setStates([]);
    setSelectedState('');
  }, [selectedCountry]);
  useEffect(() => {
    if (selectedState) client.get(`/geo/districts?stateId=${selectedState}`).then((r) => setDistricts(r.data.districts));
    else setDistricts([]);
  }, [selectedState]);

  async function addCountry(e) {
    e.preventDefault();
    await client.post('/geo/countries', newCountry);
    setNewCountry({ name: '', isoCode: '' });
    loadCountries();
  }
  async function addState(e) {
    e.preventDefault();
    await client.post('/geo/states', { name: newState, countryId: selectedCountry });
    setNewState('');
    client.get(`/geo/states?countryId=${selectedCountry}`).then((r) => setStates(r.data.states));
  }
  async function addDistrict(e) {
    e.preventDefault();
    await client.post('/geo/districts', { name: newDistrict, stateId: selectedState });
    setNewDistrict('');
    client.get(`/geo/districts?stateId=${selectedState}`).then((r) => setDistricts(r.data.districts));
  }

  return (
    <Layout>
      <p className="eyebrow">Super Admin</p>
      <h1 style={{ marginBottom: 24 }}>Countries / States / Districts</h1>
      <div className="grid-3">
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Countries</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 16 }}>
            {countries.map((c) => (
              <li key={c.id} style={{ padding: '6px 0', cursor: 'pointer', color: selectedCountry === c.id ? 'var(--ice)' : 'var(--frost)' }} onClick={() => setSelectedCountry(c.id)}>
                {c.name} <span className="mono" style={{ color: 'var(--frost-dim)' }}>({c.iso_code})</span>
              </li>
            ))}
          </ul>
          <form onSubmit={addCountry}>
            <div className="field"><label>Name</label><input required value={newCountry.name} onChange={(e) => setNewCountry({ ...newCountry, name: e.target.value })} /></div>
            <div className="field"><label>ISO code</label><input required maxLength={3} value={newCountry.isoCode} onChange={(e) => setNewCountry({ ...newCountry, isoCode: e.target.value })} /></div>
            <button className="btn btn-outline">Add country</button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>States {selectedCountry && '— ' + (countries.find((c) => c.id === selectedCountry)?.name || '')}</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 16 }}>
            {states.map((s) => (
              <li key={s.id} style={{ padding: '6px 0', cursor: 'pointer', color: selectedState === s.id ? 'var(--ice)' : 'var(--frost)' }} onClick={() => setSelectedState(s.id)}>{s.name}</li>
            ))}
          </ul>
          {selectedCountry ? (
            <form onSubmit={addState}>
              <div className="field"><label>Name</label><input required value={newState} onChange={(e) => setNewState(e.target.value)} /></div>
              <button className="btn btn-outline">Add state</button>
            </form>
          ) : <p style={{ fontSize: '0.82rem' }}>Select a country first.</p>}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Districts {selectedState && '— ' + (states.find((s) => s.id === selectedState)?.name || '')}</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 16 }}>
            {districts.map((d) => <li key={d.id} style={{ padding: '6px 0' }}>{d.name}</li>)}
          </ul>
          {selectedState ? (
            <form onSubmit={addDistrict}>
              <div className="field"><label>Name</label><input required value={newDistrict} onChange={(e) => setNewDistrict(e.target.value)} /></div>
              <button className="btn btn-outline">Add district</button>
            </form>
          ) : <p style={{ fontSize: '0.82rem' }}>Select a state first.</p>}
        </div>
      </div>
    </Layout>
  );
}
