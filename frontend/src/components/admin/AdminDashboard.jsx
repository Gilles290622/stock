import React, { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function AdminDashboard({ user }) {
  const [tab, setTab] = useState('users'); // users | subscriptions | payments
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ user_id: '', amount: 7000, phone: '+2250747672761' });
  const fmtDate = (s) => {
    if (!s) return '-';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d)) return s;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const isExpired = (s) => {
    if (!s) return true;
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d)) return false;
    return d < new Date();
  };

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
      <div className="flex gap-2 text-sm">
        <button className={`px-3 py-1 rounded ${tab==='users'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('users')}>Utilisateurs</button>
        <button className={`px-3 py-1 rounded ${tab==='subscriptions'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('subscriptions')}>Abonnements</button>
        <button className={`px-3 py-1 rounded ${tab==='payments'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('payments')}>Paiements</button>
        <button className="px-3 py-1 rounded bg-gray-100" onClick={fetchUsers}>Rafraîchir</button>
      </div>
      <p className="text-sm text-gray-600">Paiement Wave: +225 0747672761 — 7000 F CFA / mois</p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {tab === 'users' && (loading ? <div>Chargement…</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 border">ID</th>
                <th className="p-2 border">Nom</th>
                <th className="p-2 border">Email</th>
                <th className="p-2 border">Username</th>
                <th className="p-2 border">Rôle</th>
                <th className="p-2 border">Statut</th>
                <th className="p-2 border">Expire</th>
                <th className="p-2 border">Free days</th>
                <th className="p-2 border">Clients</th>
                <th className="p-2 border">Désignations</th>
                <th className="p-2 border">Mouvements</th>
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
                  <td className={`p-2 border ${isExpired(u.subscription_expires) ? 'text-red-600' : 'text-green-700'}`}>{fmtDate(u.subscription_expires)}</td>
                  <td className="p-2 border">{u.free_days ?? 0}</td>
                  <td className="p-2 border">{u.clients_count ?? 0}</td>
                  <td className="p-2 border">{u.designations_count ?? 0}</td>
                  <td className="p-2 border">{u.mouvements_count ?? 0}</td>
                  <td className="p-2 border space-x-2">
                    <button className="px-2 py-1 bg-red-600 text-white rounded" onClick={() => revoke(u.id)}>Révoquer</button>
                    <button className="px-2 py-1 bg-blue-600 text-white rounded" onClick={() => addMonth(u.id)}>+1 mois</button>
                    <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={() => addFreeDays(u.id, 7)}>+7 jours</button>
                    <button className="px-2 py-1 bg-amber-600 text-white rounded" onClick={async()=>{
                      try { const { data } = await api.post(`/api/admin/users/${u.id}/reset-password-init`); alert(`Code: ${data.code} (expire ${data.expires_at})`); }
                      catch(e){ alert('Erreur envoi code'); }
                    }}>Réinit. MDP</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === 'subscriptions' && (
        <div className="text-sm text-gray-700">
          <p>Depuis cette page, vous pouvez prolonger les abonnements (+1 mois) ou ajouter des jours de gratuité aux utilisateurs.</p>
          <p className="mt-2">Utilisez les actions dans l’onglet Utilisateurs.</p>
        </div>
      )}
      {tab === 'payments' && (
        <div className="space-y-3 text-sm">
          <div className="font-medium">Créer une intention de paiement Wave</div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs">User ID</label>
              <input className="border px-2 py-1 rounded" type="number" value={paymentForm.user_id} onChange={e=>setPaymentForm(f=>({...f, user_id:e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs">Montant</label>
              <input className="border px-2 py-1 rounded" type="number" value={paymentForm.amount} onChange={e=>setPaymentForm(f=>({...f, amount:e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs">Téléphone</label>
              <input className="border px-2 py-1 rounded" type="text" value={paymentForm.phone} onChange={e=>setPaymentForm(f=>({...f, phone:e.target.value}))} />
            </div>
            <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={async()=>{
              try {
                await api.post('/api/payments/wave/initiate', { ...paymentForm, user_id: parseInt(paymentForm.user_id,10) });
                alert('Intention créée. En attente de confirmation.');
              } catch(e) { alert('Erreur: ' + (e?.response?.data?.error || e.message)); }
            }}>Créer</button>
          </div>
          <div className="text-gray-600">Webhooks: /api/payments/wave/webhook (configurer la signature côté serveur avant prod)</div>
        </div>
      )}
    </div>
  );
}
