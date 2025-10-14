import api from './axios';

export async function pushAll() {
  const { data } = await api.post('/api/sync/push/all');
  return data;
}

// Push all using SSE progress stream, same logic as auto-sync used to do
// Usage:
// const ctrl = pushAllSSE({ onStart, onProgress, onError, onDone });
// ctrl.close() to cancel
export function pushAllSSE({ onStart, onProgress, onError, onDone } = {}) {
  try {
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const es = new EventSource(`/api/sync/push/progress${qs}`);
    es.addEventListener('start', (e) => {
      try { const data = JSON.parse(e.data || '{}'); onStart && onStart(data); } catch {}
    });
    es.addEventListener('progress', (e) => {
      try { const data = JSON.parse(e.data || '{}'); onProgress && onProgress(data); } catch {}
    });
    es.addEventListener('error', (e) => {
      let msg = 'Erreur inconnue';
      try { msg = JSON.parse(e.data || '{}')?.message || msg; } catch {}
      onError && onError(msg);
      try { es.close(); } catch {}
    });
    es.addEventListener('done', (e) => {
      let payload = {};
      try { payload = JSON.parse(e.data || '{}'); } catch {}
      onDone && onDone(payload);
      try { es.close(); } catch {}
    });
    es.onerror = () => { /* keep silent, handled via event listeners */ };
    return { close() { try { es.close(); } catch {} } };
  } catch (e) {
    onError && onError(e?.message || String(e));
    return { close() {} };
  }
}

export async function pushClients() {
  const { data } = await api.post('/api/sync/push/clients');
  return data;
}

export async function pushDesignations() {
  const { data } = await api.post('/api/sync/push/designations');
  return data;
}

export async function pushMouvements() {
  const { data } = await api.post('/api/sync/push/mouvements');
  return data;
}

export async function pushPaiements() {
  const { data } = await api.post('/api/sync/push/paiements');
  return data;
}

export async function pushDepenses() {
  const { data } = await api.post('/api/sync/push/depenses');
  return data;
}

// Pull clients + produits depuis la SOURCE (MySQL moulins) en une seule action
// Réservé à l'utilisateur 7 côté backend
export async function pullAllSource(params = {}) {
  const payload = { annex: 1, user: 7, ...params };
  const { data } = await api.post('/api/sync/pull/all', payload);
  return data;
}
