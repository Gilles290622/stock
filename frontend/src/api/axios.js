import axios from "axios";

const api = axios.create({
  // baseURL non nécessaire si on utilise des chemins relatifs + proxy Vite
});

// Intercepteur de requête: injecte automatiquement le token
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers = config.headers || {};
      // Ne pas écraser un Authorization existant si déjà fourni
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {}
  return config;
});

// Intercepteur de réponse: centralise 401/403
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      try {
        localStorage.removeItem("token");
      } catch {}
      // Laisse le composant décider de la navigation, on rejette l'erreur
    }
    return Promise.reject(err);
  }
);

export default api;