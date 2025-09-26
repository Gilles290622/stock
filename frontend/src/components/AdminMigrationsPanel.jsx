import React, { useState } from 'react';
import api from '../api/axios';

export default function AdminMigrationsPanel({ user }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!user) return null;
  const adminIds = (import.meta.env.VITE_ADMIN_IDS || '1,7').split(',').map(s=>s.trim());
  if (!adminIds.includes(String(user.id))) return null;

  async function run() {
    setLoading(true); setError(''); setResult(null);
    try {
      const { data } = await api.post('/api/admin/run-migrations');
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Erreur');
    } finally { setLoading(false); }
  }

  return (
    <div className="mt-6 p-4 border rounded bg-white shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm text-gray-800">Migrations (Admin)</h3>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1 text-xs rounded bg-green-700 text-white hover:bg-green-800 disabled:opacity-50"
        >{loading ? 'Exécution…' : 'Exécuter'}</button>
      </div>
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      {result && (
        <div className="text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto bg-gray-50 p-2 border rounded">
          {(result.logs || []).join('\n')}
          {'\n'}Applied: {(result.applied || []).join(', ') || '—'}
          {'\n'}Déjà: {(result.already || []).join(', ') || '—'}
          {result.error ? ('\nERREUR: ' + result.error) : ''}
        </div>
      )}
    </div>
  );
}