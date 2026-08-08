import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_BY_ROLE = {
  SUPER_ADMIN: [
    { to: '/admin', label: 'Overview' },
    { to: '/admin/accounts', label: 'Manage Logins' },
    { to: '/admin/geography', label: 'Countries / States / Districts' },
    { to: '/admin/tournaments', label: 'Tournaments' },
  ],
  COUNTRY_HEAD: [{ to: '/registration', label: 'Teams & Players' }, { to: '/tournaments', label: 'Tournaments' }],
  STATE_HEAD: [{ to: '/registration', label: 'Teams & Players' }, { to: '/tournaments', label: 'Tournaments' }],
  DISTRICT_HEAD: [{ to: '/registration', label: 'Teams & Players' }, { to: '/tournaments', label: 'Tournaments' }],
  REFEREE: [{ to: '/referee', label: 'My Matches' }],
  PLAYER: [{ to: '/player', label: 'My Stats' }, { to: '/player/practice', label: 'Practice Mode (Free)' }],
};

const COMMON_NAV = [{ to: '/live', label: 'Live Scores' }, { to: '/security', label: 'Sessions & Security' }];

function BrandMark() {
  return (
    <div className="brand">
      <svg className="brand-rings" viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="16" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="11" fill="none" stroke="#5FD3F3" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="6" fill="none" stroke="#FF7A45" strokeWidth="1.5" />
        <circle cx="17" cy="17" r="1.8" fill="#FF7A45" />
      </svg>
      <span className="brand-name">ICESTOCK ARENA</span>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const items = NAV_BY_ROLE[user?.role] || [];
  const allItems = [...items, ...COMMON_NAV];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />
        <nav className="nav-list">
          {allItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <p style={{ fontSize: '0.8rem', marginBottom: 4 }}>{user?.fullName}</p>
          <p className="eyebrow" style={{ marginBottom: 12 }}>{user?.role?.replace('_', ' ')}</p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
