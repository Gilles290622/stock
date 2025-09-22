import api from './axios';

export async function createDepense({ date, libelle, montant, destinataire }) {
  const res = await api.post('/api/stockDepenses', {
    date,
    libelle: String(libelle || '').trim(),
    montant: Number(montant),
    destinataire: String(destinataire || '').trim() || null,
  });
  return res.data; // { id, date, libelle, montant, destinataire }
}