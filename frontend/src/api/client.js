import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const client = axios.create({ baseURL: API_URL });

function getTokens() {
  return {
    accessToken: localStorage.getItem('icestock_access'),
    refreshToken: localStorage.getItem('icestock_refresh'),
  };
}

function setTokens({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem('icestock_access', accessToken);
  if (refreshToken) localStorage.setItem('icestock_refresh', refreshToken);
}

export function clearTokens() {
  localStorage.removeItem('icestock_access');
  localStorage.removeItem('icestock_refresh');
  localStorage.removeItem('icestock_user');
}

client.interceptors.request.use((config) => {
  const { accessToken } = getTokens();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let isRefreshing = false;
let queue = [];

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const { refreshToken } = getTokens();
      if (!refreshToken) {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject, original });
        });
      }
      isRefreshing = true;
      try {
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
        setTokens(data);
        queue.forEach((p) => p.resolve(client(p.original)));
        queue = [];
        isRefreshing = false;
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return client(original);
      } catch (refreshErr) {
        queue = [];
        isRefreshing = false;
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);

export { setTokens, getTokens };
export default client;
