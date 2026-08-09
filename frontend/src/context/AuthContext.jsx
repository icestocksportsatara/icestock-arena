import { createContext, useContext, useState, useCallback } from 'react';
import client, { setTokens, clearTokens } from '../api/client';

const AuthContext = createContext(null);

/** Turns a raw axios error into a message a non-technical user can act on,
 *  instead of a generic "server error". */
function describeError(err, fallback) {
  if (err.response?.data?.error) return err.response.data.error;
  if (err.response) return fallback; // server responded but with no message body
  // No response at all usually means: the backend is asleep (free-tier cold
  // start can take up to a minute), or the frontend's API URL / CORS setup
  // doesn't match the backend — both look identical to the user as "nothing
  // happened", so we say so explicitly rather than a vague "server error".
  return 'Could not reach the server. If this is the first request in a while, the server may be waking up — please wait 30–60 seconds and try again.';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('icestock_user');
    return raw ? JSON.parse(raw) : null;
  });
  // Holds the pending OTP challenge between step 1 (password) and step 2 (code).
  const [otpChallenge, setOtpChallenge] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  /** Step 1: email + password. Never logs the user in directly — always
   *  returns an OTP challenge that must be completed via verifyOtp(). */
  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.post('/auth/login', { email, password });
      setOtpChallenge({
        loginTicket: data.loginTicket,
        maskedEmail: data.maskedEmail,
        expiresInMinutes: data.expiresInMinutes,
        devOtp: data.devOtp, // only present when SMTP isn't configured yet
      });
      return data;
    } catch (err) {
      setError(describeError(err, 'Login failed. Check your credentials.'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Step 2: the 6-digit code from email. On success, completes the login. */
  const verifyOtp = useCallback(async (code) => {
    if (!otpChallenge) throw new Error('No login in progress.');
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.post('/auth/verify-otp', {
        loginTicket: otpChallenge.loginTicket,
        code,
      });
      setTokens(data);
      localStorage.setItem('icestock_user', JSON.stringify(data.user));
      setUser(data.user);
      setOtpChallenge(null);
      return data.user;
    } catch (err) {
      setError(describeError(err, 'Incorrect or expired code.'));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [otpChallenge]);

  const resendOtp = useCallback(async () => {
    if (!otpChallenge) return;
    setError(null);
    const { data } = await client.post('/auth/resend-otp', { loginTicket: otpChallenge.loginTicket });
    setOtpChallenge((prev) => ({ ...prev, devOtp: data.devOtp }));
  }, [otpChallenge]);

  const cancelOtp = useCallback(() => setOtpChallenge(null), []);

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
    <AuthContext.Provider value={{ user, setUser, login, verifyOtp, resendOtp, cancelOtp, otpChallenge, logout, error, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
