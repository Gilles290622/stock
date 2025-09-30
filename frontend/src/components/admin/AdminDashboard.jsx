import React, { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function AdminDashboard({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/api/admin/users');
      setUsers(data || []);
    } catch (e) { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const revoke = async (id) => {
    try { await api.post(`/api/admin/users/${id}/revoke`); fetchUsers(); } catch {}
  };
  const addMonth = async (id) => {
    try { await api.post(`/api/admin/users/${id}/subscription`, { months: 1 }); fetchUsers(); } catch {}
  };
  const addFreeDays = async (id, days = 7) => {
    try { await api.post(`/api/admin/users/${id}/free-days`, { days }); fetchUsers(); } catch {}
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Administration</h1>
      <p className="text-sm text-gray-600">Paiement Wave: +225 0747672761 — 7000 F CFA / mois</p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading ? <div>Chargement…</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 border">ID</th>
                <th className="p-2 border">Nom</th>
                <th className="p-2 border">Email</th>
                <th className="p-2 border">Username</th>
                <th className="p-2 border">Rôle</th>
                <th className="p-2 border">Statut</th>
                <th className="p-2 border">Expire</th>
                <th className="p-2 border">Free days</th>
                <th className="p-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="p-2 border">{u.id}</td>
                  <td className="p-2 border">{u.full_name}</td>
                  <td className="p-2 border">{u.email}</td>
                  <td className="p-2 border">{u.username}</td>
                  <td className="p-2 border">{u.role}</td>
                  <td className="p-2 border">{u.status}</td>
                  <td className="p-2 border">{u.subscription_expires || '-'}</td>
                  <td className="p-2 border">{u.free_days ?? 0}</td>
                  <td className="p-2 border space-x-2">
                    <button className="px-2 py-1 bg-red-600 text-white rounded" onClick={() => revoke(u.id)}>Révoquer</button>
                    <button className="px-2 py-1 bg-blue-600 text-white rounded" onClick={() => addMonth(u.id)}>+1 mois</button>
                    <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={() => addFreeDays(u.id, 7)}>+7 jours</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
