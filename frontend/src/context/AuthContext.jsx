import { createContext, useContext, useState, useCallback } from 'react';
import client, { setTokens, clearTokens } from '../api/client';

const AuthContext = createContext(null);

/** Turns a raw axios error into a message a non-technical user can act on. */
function describeError(err, fallback) {
  if (err.response?.data?.error) return err.response.data.error;
  if (err.response) return fallback;
  // No response at all usually means the backend is asleep (free-tier cold
  // start can take up to a minute) or the frontend's API URL doesn't match
  // the backend — both look like "nothing happened", so say so explicitly.
  return 'Could not reach the server. If this is the first request in a while, the server may be waking up — please wait 30–60 seconds and try again.';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('icestock_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.post('/auth/login', { email, password });
      setTokens(data);
      localStorage.setItem('icestock_user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } catch (err) {
      setError(describeError(err, 'Login failed. Check your credentials.'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('icestock_refresh');
    try {
      await client.post('/auth/logout', { refreshToken });
    } catch {
      /* ignore — clear local state regardless */
    }
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, error, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
