import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { pushAll, pullAllSource } from '../api/sync';

export default function Header({ username, userLogo, userNumber, onLogout, showSync = true, userId, role, entreprise: initialEntreprise, onEntrepriseChange }) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState('');
  const [editingEnt, setEditingEnt] = useState(false);
  const [entreprise, setEntreprise] = useState(initialEntreprise || '');
  const [savingEnt, setSavingEnt] = useState(false);
  const [entMsg, setEntMsg] = useState('');
  const [remoteInfo, setRemoteInfo] = useState({ checking: false, hasUpdates: false });

  useEffect(() => { setEntreprise(initialEntreprise || ''); }, [initialEntreprise]);

  // Vérifier s'il y a des nouveautés côté distant (badge)
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        setRemoteInfo(prev => ({ ...prev, checking: true }));
        const { data } = await api.get('/api/sync/remote-summary');
        if (stop) return;
        setRemoteInfo({ checking: false, hasUpdates: !!data?.hasUpdates });
      } catch {
        if (stop) return; setRemoteInfo({ checking: false, hasUpdates: false });
      }
    }
    // au chargement + toutes les 2 minutes
    check();
    const id = setInterval(check, 2 * 60 * 1000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  async function saveEntreprise() {
    if (savingEnt) return;
    setSavingEnt(true); setEntMsg('');
    try {
      const res = await api.put('/api/entreprise', { entreprise });
      setEditingEnt(false);
      if (onEntrepriseChange) onEntrepriseChange(res.data.entreprise || entreprise);
      setEntMsg('Entreprise mise à jour');
      setTimeout(()=>setEntMsg(''), 1800);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Erreur';
      setEntMsg(msg);
    } finally { setSavingEnt(false); }
  }

  async function handleSyncAll() {
    try {
      setSyncMsg('');
      setSyncing(true);
      const res = await pushAll();
      const r = res?.result || {};
      const msg = `Synchronisé: clients=${r.clients ?? 0}, designations=${r.designations ?? 0}, mouvements=${r.mouvements ?? 0}, paiements=${r.paiements ?? 0}, depenses=${r.depenses ?? 0}`;
      setSyncMsg(msg);
    } catch (e) {
      const err = e?.response?.data?.error || e?.message || 'Erreur';
      setSyncMsg(`Erreur de synchronisation: ${err}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handlePullAll() {
    try {
      setPullMsg('');
      setPulling(true);
      const res = await pullAllSource();
      const c = res?.clients?.result || {};
      const p = res?.produits?.result || {};
      const msg = `Mise à jour SOURCE: clients +${c.inserted ?? 0} / maj ${c.updated ?? 0} (skipped ${c.skipped ?? 0}); produits +${p.inserted ?? 0} (skipped ${p.skipped ?? 0})`;
      setPullMsg(msg);
    } catch (e) {
      const err = e?.response?.data?.error || e?.message || 'Erreur';
      setPullMsg(`Erreur mise à jour SOURCE: ${err}`);
    } finally {
      setPulling(false);
    }
  }

  const isAdmin = role === 'admin';
  return (
    <header className={`${isAdmin ? 'bg-indigo-700' : 'bg-green-700'} text-white py-4 px-8 flex justify-between items-center shadow`}>
      <div className="flex items-center gap-4">
        {/* Logo utilisateur */}
        <img
          src={userLogo || "/default-avatar.svg"}
          alt="Avatar utilisateur"
          className="h-10 w-10 rounded-full border object-cover"
        />
        <div className="font-bold text-2xl tracking-wide">{isAdmin ? 'Administration' : 'Gestion de stock'}</div>
        {username && (
          <div className="ml-2">
            {!editingEnt && (
              <button
                type="button"
                className="px-2 py-1 text-xs rounded bg-green-800 hover:bg-green-900 transition border border-green-600"
                title="Modifier le nom d'entreprise"
                onClick={() => setEditingEnt(true)}
              >
                {entreprise ? entreprise : 'Ajouter entreprise'}
              </button>
            )}
            {editingEnt && (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={entreprise}
                  onChange={e=>setEntreprise(e.target.value)}
                  className="px-2 py-1 text-xs rounded border border-green-300 text-black"
                  placeholder="Nom entreprise"
                  maxLength={255}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={savingEnt}
                  onClick={saveEntreprise}
                  className="px-2 py-1 text-xs rounded bg-white text-green-700 border border-green-500 hover:bg-green-50 disabled:opacity-50"
                >{savingEnt ? '...' : 'OK'}</button>
                <button
                  type="button"
                  onClick={()=>{ setEditingEnt(false); setEntreprise(initialEntreprise || ''); }}
                  className="px-2 py-1 text-xs rounded bg-transparent border border-green-300 hover:bg-green-800/30"
                >X</button>
              </div>
            )}
            {entMsg && <div className="text-[10px] text-green-200 mt-0.5">{entMsg}</div>}
          </div>
        )}
        {/* Numéro utilisateur */}
        {userNumber && (
          <span className="bg-green-800 px-3 py-1 rounded-full text-xs font-semibold ml-2">
            N° {userNumber}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {username ? (
          <>
            {!isAdmin && showSync && (
              <button
                className={`px-3 py-2 rounded shadow ${syncing ? 'bg-gray-300 cursor-not-allowed' : 'bg-white text-green-700 hover:bg-green-50'}`}
                onClick={handleSyncAll}
                disabled={syncing}
                title="Synchroniser toutes les données locales vers la base distante"
              >
                {syncing ? 'Synchronisation…' : 'Synchroniser'}
              </button>
            )}
            {/* Indicateur de nouveautés distantes */}
            {!isAdmin && (
              <span className={`text-xs px-2 py-1 rounded ${remoteInfo.hasUpdates ? 'bg-yellow-200 text-yellow-900 border border-yellow-400' : 'bg-gray-100 text-gray-600 border border-gray-300'}`} title="État des nouveautés distantes (vérification périodique)">
                {remoteInfo.checking ? 'Vérification…' : (remoteInfo.hasUpdates ? 'Nouveautés disponibles' : 'À jour')}
              </span>
            )}
            {/* MAJ SOURCE - visible uniquement pour l'utilisateur 7 et non admin */}
            {!isAdmin && Number(userId) === 7 && (
              <button
                className={`px-3 py-2 rounded shadow ${pulling ? 'bg-gray-300 cursor-not-allowed' : 'bg-white text-green-700 hover:bg-green-50'}`}
                onClick={handlePullAll}
                disabled={pulling}
                title="Importer clients + produits depuis la SOURCE (structure-elmorijah.com)"
              >
                {pulling ? 'MAJ SOURCE…' : 'MAJ SOURCE'}
              </button>
            )}
            {isAdmin && (
              <button
                className="px-3 py-2 rounded shadow bg-white text-indigo-700 hover:bg-indigo-50"
                onClick={() => navigate('/admin')}
                title="Espace administration"
              >
                Admin
              </button>
            )}
            {/* Lien profil/configuration (caché pour admin) */}
            {!isAdmin && (
              <button
                className="underline font-medium hover:text-green-200"
                onClick={() => navigate("/profile")}
                title="Paramètres du profil"
              >
                Profil
              </button>
            )}
            <span className="font-medium">Session : <span className="underline">{username}</span></span>
            <button
              className="p-2 rounded-full hover:bg-green-800 focus:outline-none"
              title="Déconnexion"
              onClick={onLogout}
            >
              {/* Icône de déconnexion SVG */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
              </svg>
            </button>
          </>
        ) : (
          <button className="bg-white text-green-700 px-4 py-2 rounded shadow hover:bg-green-50">
            Connexion
          </button>
        )}
      </div>
      {(syncMsg || pullMsg) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-green-50 text-green-900 px-3 py-1 rounded shadow text-sm">
          {pullMsg || syncMsg}
        </div>
      )}
    </header>
  );
}