import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import AdminOverview from './pages/admin/AdminOverview';
import AdminAccounts from './pages/admin/AdminAccounts';
import AdminGeography from './pages/admin/AdminGeography';
import TournamentsPage from './pages/TournamentsPage';
import RegistrationPage from './pages/RegistrationPage';
import RefereeDashboard from './pages/referee/RefereeDashboard';
import RefereeScoring from './pages/referee/RefereeScoring';
import PlayerStats from './pages/player/PlayerStats';
import PlayerPractice from './pages/player/PlayerPractice';

const ROLE_HOME = {
  SUPER_ADMIN: '/admin',
  COUNTRY_HEAD: '/registration',
  STATE_HEAD: '/registration',
  DISTRICT_HEAD: '/registration',
  REFEREE: '/referee',
  PLAYER: '/player',
};

function RoleHome() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
}

const HEAD_ROLES = ['COUNTRY_HEAD', 'STATE_HEAD', 'DISTRICT_HEAD'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/" element={<RoleHome />} />

      <Route path="/admin" element={<ProtectedRoute allow={['SUPER_ADMIN']}><AdminOverview /></ProtectedRoute>} />
      <Route path="/admin/accounts" element={<ProtectedRoute allow={['SUPER_ADMIN']}><AdminAccounts /></ProtectedRoute>} />
      <Route path="/admin/geography" element={<ProtectedRoute allow={['SUPER_ADMIN']}><AdminGeography /></ProtectedRoute>} />
      <Route path="/admin/tournaments" element={<ProtectedRoute allow={['SUPER_ADMIN']}><TournamentsPage /></ProtectedRoute>} />

      <Route path="/registration" element={<ProtectedRoute allow={HEAD_ROLES}><RegistrationPage /></ProtectedRoute>} />
      <Route path="/tournaments" element={<ProtectedRoute allow={[...HEAD_ROLES, 'SUPER_ADMIN']}><TournamentsPage /></ProtectedRoute>} />

      <Route path="/referee" element={<ProtectedRoute allow={['REFEREE']}><RefereeDashboard /></ProtectedRoute>} />
      <Route path="/referee/matches/:matchId" element={<ProtectedRoute allow={['REFEREE']}><RefereeScoring /></ProtectedRoute>} />

      <Route path="/player" element={<ProtectedRoute allow={['PLAYER']}><PlayerStats /></ProtectedRoute>} />
      <Route path="/player/practice" element={<ProtectedRoute allow={['PLAYER']}><PlayerPractice /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
