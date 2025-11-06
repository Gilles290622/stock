import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';
import { pushAllSSE, pullAllSSE } from '../../api/sync';

export default function AdminDashboard({ user }) {
  const [tab, setTab] = useState('users'); // users | subscriptions | payments
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ user_id: '', amount: 7000, phone: '+2250747672761' });
  const [resources, setResources] = useState([]); // fichiers disponibles dans /stock/ressources
  const [resourcesLoading, setResourcesLoading] = useState(false);
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

  const fetchResources = async () => {
    setResourcesLoading(true);
    try {
      const { data } = await api.get('/api/resources/list');
      if (Array.isArray(data)) setResources(data);
    } catch (e) { /* non bloquant */ }
    finally { setResourcesLoading(false); }
  };
  useEffect(() => { fetchResources(); }, []);

  const revoke = async (id) => {
    try { await api.post(`/api/admin/users/${id}/revoke`); fetchUsers(); } catch {}
  };
  const addMonth = async (id) => {
    try { await api.post(`/api/admin/users/${id}/subscription`, { months: 1 }); fetchUsers(); } catch {}
  };
  const addFreeDays = async (id, days = 7) => {
    try { await api.post(`/api/admin/users/${id}/free-days`, { days }); fetchUsers(); } catch {}
  };
  // Sync enablement (like in App.jsx): visible en local ou si VITE_SYNC_ENABLED=true
  const ENV_SYNC_ENABLED = (typeof import.meta !== 'undefined' && import.meta.env && String(import.meta.env.VITE_SYNC_ENABLED).toLowerCase() === 'true');
  let RUNTIME_LOCAL = false;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const host = String(window.location.hostname || '').toLowerCase();
      const port = String(window.location.port || '');
      RUNTIME_LOCAL = (/^(localhost|127\.0\.0\.1|::1)$/).test(host) || port === '3001';
    }
  } catch {}
  const SYNC_ENABLED = ENV_SYNC_ENABLED || RUNTIME_LOCAL;
  const RECONCILE_AVAILABLE = RUNTIME_LOCAL; // Réconciliation: uniquement en local (évite 404 côté online)
  const PUBLISH_AVAILABLE = RUNTIME_LOCAL; // Publication de l'installateur: nécessite PowerShell/7-Zip localement

  // Sync local <-> online
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncPercent, setSyncPercent] = useState(0);
  const syncCtrlRef = useRef(null);
  const cancelSync = () => { try { syncCtrlRef.current?.close(); } catch {} setSyncRunning(false); setSyncMsg(''); setSyncPercent(0); };
  const startPull = () => {
    if (!SYNC_ENABLED || syncRunning) return;
    setSyncRunning(true); setSyncMsg('Démarrage de l\'import…'); setSyncPercent(0);
    syncCtrlRef.current = pullAllSSE({
      onStart: () => setSyncMsg('Import: préparation…'),
      onProgress: (ev) => { setSyncMsg(ev.text || 'Import en cours…'); if (typeof ev.percent === 'number') setSyncPercent(ev.percent); },
      onError: (msg) => { setSyncMsg(`Erreur: ${msg}`); setSyncRunning(false); },
      onDone: (payload) => { setSyncMsg(payload.text || 'Import terminé'); setSyncRunning(false); fetchUsers(); },
    });
  };
  const startPush = () => {
    if (!SYNC_ENABLED || syncRunning) return;
    setSyncRunning(true); setSyncMsg('Démarrage de la publication…'); setSyncPercent(0);
    syncCtrlRef.current = pushAllSSE({
      onStart: () => setSyncMsg('Publication: préparation…'),
      onProgress: (ev) => { setSyncMsg(ev.text || 'Publication en cours…'); if (typeof ev.percent === 'number') setSyncPercent(ev.percent); },
      onError: (msg) => { setSyncMsg(`Erreur: ${msg}`); setSyncRunning(false); },
      onDone: (payload) => { setSyncMsg(payload.text || 'Publication terminée'); setSyncRunning(false); },
    });
  };
  const deleteUser = async (id) => {
    if (!window.confirm('Supprimer cet utilisateur et toutes ses données ? Cette action est irréversible.')) return;
    try {
      await api.delete(`/api/admin/users/${id}`);
      fetchUsers();
    } catch (e) {
      alert(e?.response?.data?.error || 'Suppression impossible');
    }
  };

  // Publication de l'installateur (zip)
  const [publishing, setPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishMsg, setPublishMsg] = useState('');
  const publishInstaller = async () => {
    if (!PUBLISH_AVAILABLE || publishing) return;
    setPublishing(true); setPublishUrl(''); setPublishMsg('Construction du paquet…');
    try {
      const { data } = await api.post('/api/admin/install-pack/publish');
      if (data?.success && data?.url) {
        setPublishUrl(data.url);
        setPublishMsg(`Publié: ${data.file} (${Math.round((data.size||0)/1024)} Ko)`);
        // Recharger la liste des ressources publiées
        fetchResources();
      } else {
        setPublishMsg('Publication terminée, mais URL indisponible.');
      }
    } catch (e) {
      setPublishMsg(e?.response?.data?.error || e.message || 'Erreur');
    } finally { setPublishing(false); }
  };

  // Réconciliation utilisateurs (local <- online)
  const [reconciling, setReconciling] = useState(false);
  const runReconcile = async () => {
    if (!RECONCILE_AVAILABLE) { alert('La réconciliation est disponible uniquement en local.'); return; }
    if (!SYNC_ENABLED || reconciling) return;
    setReconciling(true);
    try {
      // 1) Dry-run
      const { data: preview } = await api.post('/api/admin/reconcile-users', { dryRun: true });
      const ids = Array.isArray(preview?.toDelete) ? preview.toDelete : [];
      if (!ids.length) {
        alert('Aucun utilisateur local à supprimer. Déjà aligné.');
        return;
      }
      const confirmText = `Voulez-vous supprimer en local ${ids.length} utilisateur(s) absent(s) en ligne ?\nIDs: ${ids.join(', ')}`;
      if (!window.confirm(confirmText)) return;
      // 2) Apply
      const { data: applied } = await api.post('/api/admin/reconcile-users', { dryRun: false });
      const deleted = (applied?.deleted || []).length;
      const deactivated = (applied?.deactivated || []).length;
      alert(`Réconciliation terminée. Supprimés: ${deleted}. Désactivés: ${deactivated}.`);
      fetchUsers();
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Erreur de réconciliation');
    } finally {
      setReconciling(false);
    }
  };

  // Préférer l'alias fixe s'il existe, sinon le plus récent
  let latestResource = null;
  if (Array.isArray(resources) && resources.length) {
    latestResource = resources.find(r => r && (r.name === 'stock_payload_latest.zip' || r.name === 'stock_payload_latest.exe')) || resources[0];
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Administration</h1>
      <div className="flex gap-2 text-sm">
        <button className={`px-3 py-1 rounded ${tab==='users'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('users')}>Utilisateurs</button>
        <button className={`px-3 py-1 rounded ${tab==='subscriptions'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('subscriptions')}>Abonnements</button>
        <button className={`px-3 py-1 rounded ${tab==='payments'?'bg-indigo-600 text-white':'bg-gray-100'}`} onClick={()=>setTab('payments')}>Paiements</button>
        <button className="px-3 py-1 rounded bg-gray-100" onClick={fetchUsers}>Rafraîchir</button>
        {SYNC_ENABLED && (
          <>
            <span className="mx-2 text-gray-400">|</span>
            <button className="px-3 py-1 rounded bg-emerald-600 text-white" onClick={startPull} disabled={syncRunning} title="Importe les données depuis l’online vers le local (upsert, non destructif)">Importer (depuis l’online)</button>
            <button className="px-3 py-1 rounded bg-purple-600 text-white" onClick={startPush} disabled={syncRunning} title="Exporte les données du local vers l’online (upsert, non destructif)">Exporter (vers l’online)</button>
            {syncRunning && <button className="px-3 py-1 rounded bg-gray-200 text-gray-700" onClick={cancelSync}>Annuler</button>}
            {RECONCILE_AVAILABLE && (
              <button className="ml-2 px-3 py-1 rounded bg-black text-white" onClick={runReconcile} disabled={reconciling} title="Aligne les COMPTES (utilisateurs) locaux sur l’online : supprime/désactive ceux absents en ligne">Réconcilier utilisateurs (online → local)</button>
            )}
            {PUBLISH_AVAILABLE && (
              <>
                <span className="mx-2 text-gray-400">|</span>
                <button className="px-3 py-1 rounded bg-amber-700 text-white" onClick={publishInstaller} disabled={publishing} title="Construit et publie le ZIP installateur sur jts-services.shop/stock/ressources">Publier l’installateur (zip)</button>
              </>
            )}
          </>
        )}
      </div>
      {SYNC_ENABLED && (
        <div className="text-xs text-slate-600">
          <ul className="list-disc pl-5">
            <li><b>Importer</b> (online → local): ajoute/met à jour les données locales depuis l’online, sans supprimer.</li>
            <li><b>Exporter</b> (local → online): ajoute/met à jour les données en ligne depuis le local, sans supprimer.</li>
            {RECONCILE_AVAILABLE && <li><b>Réconcilier utilisateurs</b> (online → local): supprime ou désactive en local les <i>utilisateurs</i> absents en ligne (action ciblée comptes, distincte des données métier).</li>}
            {PUBLISH_AVAILABLE && <li><b>Publier l’installateur</b> (local → online): génère un ZIP protégé par mot de passe et le publie sur le site pour installation sur un autre ordinateur.</li>}
          </ul>
        </div>
      )}
      {SYNC_ENABLED && syncRunning && (
        <div className="text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded px-3 py-2 inline-flex items-center gap-2">
          <span className="inline-block w-28">{syncPercent ? `${syncPercent}%` : ''}</span>
          <span className="truncate max-w-[50ch]" title={syncMsg}>{syncMsg}</span>
        </div>
      )}
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
                    <button className="px-2 py-1 bg-black text-white rounded" onClick={() => deleteUser(u.id)}>Supprimer</button>
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
      <div className="text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-medium">Installateur:</span>
          {PUBLISH_AVAILABLE && (
            <>
              <span>{publishing ? 'En cours…' : (publishMsg || 'Prêt')}</span>
              {publishUrl && <a className="text-blue-700 underline" href={publishUrl} target="_blank" rel="noreferrer">Télécharger (dernier)</a>}
            </>
          )}
          {!PUBLISH_AVAILABLE && <span>Vous pouvez télécharger l’installateur publié depuis cette page.</span>}
          {/* Lien principal demandé: "Installation" (télécharge le dernier installeur) */}
          {latestResource && (
            <a className="ml-auto px-3 py-1 rounded bg-indigo-600 text-white" href={latestResource.url} download target="_blank" rel="noreferrer" title={`Télécharger ${latestResource.name}`}>
              Installation
            </a>
          )}
        </div>
        <div>
          {resourcesLoading ? (
            <span>Chargement des ressources…</span>
          ) : (
            resources && resources.length ? (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-slate-600">Fichiers disponibles:</span>
                {resources.slice(0,5).map((r)=> (
                  <a key={r.url} className="px-2 py-1 bg-white border rounded text-blue-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                ))}
                {resources.length > 5 && <span className="text-slate-500">… ({resources.length-5} autres)</span>}
              </div>
            ) : (
              <span>Aucun fichier publié pour le moment.</span>
            )
          )}
        </div>
      </div>
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
