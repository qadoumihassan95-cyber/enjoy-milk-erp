import axios, { AxiosError } from 'axios';

/**
 * يحدّد رابط الـ API بترتيب أولويات مضمون:
 *  1) NEXT_PUBLIC_API_URL إن ضُبط فعلاً (غير فارغ وغير localhost)
 *  2) على Render: يشتق رابط الـ api من اسم الـ web (enjoymilk-web → enjoymilk-api)
 *  3) محلياً: localhost:3001
 * هذا يتفادى مشكلة عدم تمرير build-arg على Render.
 */
function resolveApiUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  const isBrowser = typeof window !== 'undefined';
  const onRender =
    isBrowser && window.location.hostname.endsWith('.onrender.com');

  // إن كنّا على Render، تجاهل قيمة localhost المخبوزة خطأً واشتق الرابط الصحيح
  if (onRender) {
    if (env && !env.includes('localhost')) return env;
    return `https://${window.location.hostname.replace('-web', '-api')}`;
  }

  return env || 'http://localhost:3001';
}

const API_URL = resolveApiUrl();

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: false,
});

// Attach token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — try refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest: any = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      typeof window !== 'undefined' &&
      !originalRequest.url?.includes('/auth/')
    ) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_URL}/api/auth/refresh`, {
            refreshToken,
          });
          localStorage.setItem('accessToken', res.data.accessToken);
          localStorage.setItem('refreshToken', res.data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${res.data.accessToken}`;
          return api(originalRequest);
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
