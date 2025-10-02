import axios from "axios";

// Permet d'overrider la base API en production (ex: autre domaine) via VITE_API_BASE
// Laisser vide pour utiliser des chemins relatifs (utile en dev avec proxy et en prod même domaine)
const baseURL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) ? import.meta.env.VITE_API_BASE : '';

const api = axios.create({ baseURL });

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

// Intercepteur de réponse: centralise 401 (ne PAS se déconnecter pour 402/403)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      try {
        localStorage.removeItem("token");
      } catch {}
      // Laisse le composant décider de la navigation, on rejette l'erreur
    }
    // 402 (abonnement expiré) et 403 (interdit) doivent être gérés côté UI sans supprimer le token
    return Promise.reject(err);
  }
);

export default api;