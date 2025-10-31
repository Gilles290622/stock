                                                                        import api from './axios';

// Helpers pour formater les événements SSE en messages lisibles (FR)
function stepLabel(step) {
  switch (step) {
    case 'users': return 'Utilisateurs';
    case 'profiles': return 'Profils';
    case 'subscriptions': return 'Abonnements (paiements)';
    case 'categories': return 'Catégories';
    case 'clients': return 'Clients';
    case 'designations': return 'Produits';
    case 'mouvements': return 'Mouvements';
    case 'paiements': return 'Paiements';
    case 'depenses': return 'Dépenses';
    default: return step || '';
  }
}

function formatProgressEventFr(ev = {}) {
  const { step, label, status, index, total, percent, result = {} } = ev || {};
  const lbl = label || stepLabel(step);
  let details = '';
  // Supporte plusieurs schémas de payload côté backend (sent / pulled / before/after)
  if (typeof result.sent === 'number') details = `${result.sent} envoyés`;
  else if (typeof result.pulled === 'number') details = `${result.pulled} importés`;

  const before = result.remoteBefore ?? result.localBefore;
  const after = result.remoteAfter ?? result.localAfter;
  if (typeof before === 'number' && typeof after === 'number') {
    const arrow = before === after ? '↔' : '→';
    details = details ? `${details} (${before} ${arrow} ${after})` : `${before} ${arrow} ${after}`;
  }
  const base = lbl ? `${lbl}` : 'Étape';
  const p = typeof percent === 'number' ? ` — ${percent}%` : '';
  const it = (typeof index === 'number' && typeof total === 'number') ? ` [${index}/${total}]` : '';
  const st = status ? ` (${status})` : '';
  const msg = details ? `${base}${st}${it}${p}: ${details}` : `${base}${st}${it}${p}`;
  return { text: msg, label: lbl, status, index, total, percent, result };
}

function formatDoneEventFr(payload = {}) {
  if (payload?.reason === 'remote_disabled') return { text: 'Synchronisation désactivée sur la version en ligne', ...payload };
  if (payload?.error) return { text: `Terminé avec erreurs: ${payload.error}`, ...payload };
  return { text: 'Synchronisation terminée', ...payload };
}

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
      try { const raw = JSON.parse(e.data || '{}'); const formatted = formatProgressEventFr(raw); onProgress && onProgress({ ...raw, ...formatted }); } catch {}
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
      const formatted = formatDoneEventFr(payload);
      onDone && onDone({ ...payload, ...formatted });
      try { es.close(); } catch {}
    });
    es.onerror = () => { /* keep silent, handled via event listeners */ };
    return { close() { try { es.close(); } catch {} } };
  } catch (e) {
    onError && onError(e?.message || String(e));
    return { close() {} };
  }
}

// Pull all from remote to local using SSE progress stream
export function pullAllSSE({ onStart, onProgress, onError, onDone } = {}) {
  try {
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const es = new EventSource(`/api/sync/pull-general/progress${qs}`);
    es.addEventListener('start', (e) => {
      try { const data = JSON.parse(e.data || '{}'); onStart && onStart(data); } catch {}
    });
    es.addEventListener('progress', (e) => {
      try { const raw = JSON.parse(e.data || '{}'); const formatted = formatProgressEventFr(raw); onProgress && onProgress({ ...raw, ...formatted }); } catch {}
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
      const formatted = formatDoneEventFr(payload);
      onDone && onDone({ ...payload, ...formatted });
      try { es.close(); } catch {}
    });
    es.onerror = () => { /* handled above */ };
    return { close() { try { es.close(); } catch {} } };
  } catch (e) {
    onError && onError(e?.message || String(e));
    return { close() {} };
  }
}

// (duplicate removed) pullAllSSE is defined once above.

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
