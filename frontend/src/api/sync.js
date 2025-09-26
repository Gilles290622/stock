import api from './axios';

export async function pushAll() {
  const { data } = await api.post('/api/sync/push/all');
  return data;
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
