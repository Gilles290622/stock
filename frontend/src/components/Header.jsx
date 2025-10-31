import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { pushAll, pullAllSource, pushAllSSE, pullAllSSE } from '../api/sync';

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
  const [remoteInfo, setRemoteInfo] = useState({ checking: false, hasUpdates: false, enabled: true });

  useEffect(() => { setEntreprise(initialEntreprise || ''); }, [initialEntreprise]);

  // Vérifier s'il y a des nouveautés côté distant (badge)
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        if (!showSync) { return; }
        setRemoteInfo(prev => ({ ...prev, checking: true }));
        const { data } = await api.get('/api/sync/remote-summary');
        if (stop) return;
        setRemoteInfo({ checking: false, hasUpdates: !!data?.hasUpdates, enabled: (typeof data?.enabled === 'boolean' ? data.enabled : true) });
      } catch {
        if (stop) return; setRemoteInfo({ checking: false, hasUpdates: false, enabled: false });
      }
    }
    // au chargement + toutes les 2 minutes
    check();
    const id = setInterval(check, 2 * 60 * 1000);
    return () => { stop = true; clearInterval(id); };
  }, [showSync]);

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
    // Nouvelle implémentation: SSE comme l'auto-sync
    if (syncing) return;
    setSyncMsg('');
    setSyncing(true);
    let lastLabel = '';
    const ctrl = pushAllSSE({
      onStart: (data) => {
        setSyncMsg('Démarrage de la synchronisation…');
      },
      onProgress: (p) => {
        const label = p?.label || p?.step || '';
        lastLabel = label;
        const percent = (typeof p?.percent === 'number') ? ` ${p.percent}%` : '';
        const message = p?.message || '';
        setSyncMsg(`${label}${percent}${message ? ' - ' + message : ''}`);
      },
      onError: (msg) => {
        setSyncMsg(`Erreur de synchronisation: ${msg}`);
        setSyncing(false);
      },
      onDone: (payload) => {
        if (payload?.success) {
          setSyncMsg(`Synchronisation terminée${lastLabel ? ' - ' + lastLabel : ''}`);
        } else {
          setSyncMsg('Synchronisation terminée avec avertissements');
        }
        setSyncing(false);
      }
    });
    // Optionnel: renvoyer le contrôleur pour annulation si nécessaire
    return ctrl;
  }

  async function handlePullAllSSE() {
    if (pulling) return;
    setPullMsg('');
    setPulling(true);
    let lastLabel = '';
    const ctrl = pullAllSSE({
      onStart: () => { setPullMsg('Démarrage de l\'import…'); },
      onProgress: (p) => {
        const label = p?.label || p?.step || '';
        lastLabel = label;
        const percent = (typeof p?.percent === 'number') ? ` ${p.percent}%` : '';
        const message = p?.message || '';
        setPullMsg(`${label}${percent}${message ? ' - ' + message : ''}`);
      },
      onError: (msg) => { setPullMsg(`Erreur import: ${msg}`); setPulling(false); },
      onDone: (payload) => {
        setPullMsg(payload?.success ? `Import terminé${lastLabel ? ' - ' + lastLabel : ''}` : 'Import terminé avec avertissements');
        setPulling(false);
      }
    });
    return ctrl;
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
  const isAuthenticated = !!(userId || username);
  // Résout les chemins d'images/assets en tenant compte de la base '/stock/' en production
  function resolveAssetPath(p) {
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
    // Si p commence par '/', on préfixe avec la base sans slash final (ex: '/stock' + '/default-avatar.svg')
    if (p.startsWith('/')) return (base.replace(/\/$/, '')) + p;
    // Sinon, on concatène (ex: '/stock/' + 'default-avatar.svg')
    return base + p;
  }
  const appLogo = resolveAssetPath('logo.png');
  const appFavicon = resolveAssetPath('favicon.png');
  return (
    <header className={`sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/80 bg-white border-b border-slate-200 text-slate-800`}>
      <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo utilisateur */}
          <img
            src={userLogo ? resolveAssetPath(userLogo) : (appLogo || appFavicon || resolveAssetPath('default-avatar.svg'))}
            alt="Avatar utilisateur"
            className="h-9 w-9 rounded-full border border-slate-200 object-cover bg-white"
          />
          <div className="font-semibold text-lg truncate">{isAdmin ? 'Administration' : 'Gestion de stock'}</div>
        {isAuthenticated && (
          <div className="ml-2">
            {!editingEnt && (
              <button
                type="button"
                className="px-2.5 py-1.5 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-900 transition border border-slate-700 shadow-sm"
                title="Modifier le nom d'entreprise"
                onClick={() => setEditingEnt(true)}
              >
                {entreprise ? entreprise : 'Ajouter entreprise'}
              </button>
            )}
            {editingEnt && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={entreprise}
                  onChange={e=>setEntreprise(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-md border border-slate-300 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="Nom entreprise"
                  maxLength={255}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={savingEnt}
                  onClick={saveEntreprise}
                  className="px-2.5 py-1.5 text-xs rounded-md bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 disabled:opacity-50"
                >{savingEnt ? '...' : 'OK'}</button>
                <button
                  type="button"
                  onClick={()=>{ setEditingEnt(false); setEntreprise(initialEntreprise || ''); }}
                  className="px-2.5 py-1.5 text-xs rounded-md bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-100"
                >X</button>
              </div>
            )}
            {entMsg && <div className="text-[10px] text-slate-500 mt-0.5">{entMsg}</div>}
          </div>
        )}
        {/* Numéro utilisateur */}
        {isAuthenticated && userNumber && (
          <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-medium ml-2 border border-slate-200">
            N° {userNumber}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isAuthenticated ? (
          <>
            {!isAdmin && showSync && (
              <button
                className={`px-3 py-2 rounded-md shadow-sm border ${syncing ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'}`}
                onClick={handleSyncAll}
                disabled={syncing}
                title="Publier (envoyer) toutes les données locales vers la base distante"
              >
                {syncing ? 'Publication…' : 'Publier'}
              </button>
            )}
            {!isAdmin && showSync && (
              <button
                className={`px-3 py-2 rounded-md shadow-sm border ${pulling ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'}`}
                onClick={handlePullAllSSE}
                disabled={pulling}
                title="Importer les données depuis la base distante vers le local"
              >
                {pulling ? 'Import…' : 'Importer'}
              </button>
            )}
            {/* Indicateur de nouveautés distantes */}
            {!isAdmin && showSync && (
              <span
                className={`text-xs px-2.5 py-1 rounded-md border ${
                  remoteInfo.checking
                    ? 'bg-slate-50 text-slate-600 border-slate-200'
                    : (!remoteInfo.enabled
                        ? 'bg-slate-50 text-slate-500 border-slate-200'
                        : (remoteInfo.hasUpdates
                            ? 'bg-amber-50 text-amber-900 border-amber-300'
                            : 'bg-slate-50 text-slate-600 border-slate-200'))
                }`}
                title="État des nouveautés distantes (vérification périodique)"
              >
                {remoteInfo.checking
                  ? 'Vérification…'
                  : (!remoteInfo.enabled
                      ? 'Synchronisation désactivée'
                      : (remoteInfo.hasUpdates ? 'Nouveautés disponibles' : 'À jour'))}
              </span>
            )}
            {/* MAJ SOURCE - visible uniquement pour l'utilisateur 7 et non admin */}
            {!isAdmin && showSync && Number(userId) === 7 && (
              <button
                className={`px-3 py-2 rounded-md shadow-sm border ${pulling ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'}`}
                onClick={handlePullAll}
                disabled={pulling}
                title="Importer clients + produits depuis la SOURCE (structure-elmorijah.com)"
              >
                {pulling ? 'MAJ SOURCE…' : 'MAJ SOURCE'}
              </button>
            )}
            {isAdmin && (
              <button
                className="px-3 py-2 rounded-md shadow-sm border bg-white text-indigo-700 hover:bg-indigo-50 border-slate-200"
                onClick={() => navigate('/admin')}
                title="Espace administration"
              >
                Admin
              </button>
            )}
            {/* Lien profil/configuration (caché pour admin) */}
            {!isAdmin && (
              <button
                className="underline font-medium text-slate-700 hover:text-slate-900"
                onClick={() => navigate("/profile")}
                title="Paramètres du profil"
              >
                Profil
              </button>
            )}
            <span className="font-medium text-slate-700">Session : <span className="underline decoration-slate-300 underline-offset-4">{username || 'Utilisateur'}</span></span>
            <button
              className="p-2 rounded-full hover:bg-slate-100 focus:outline-none border border-slate-200"
              title="Déconnexion"
              onClick={onLogout}
            >
              {/* Icône de déconnexion SVG */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
              </svg>
            </button>
          </>
        ) : (
          <button
            className="px-4 py-2 rounded-md shadow-sm border bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
            onClick={() => navigate('/login')}
          >
            Connexion
          </button>
        )}
      </div>
      {(syncMsg || pullMsg) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-[60px] mt-2 bg-slate-50 text-slate-700 px-3 py-1 rounded-md shadow-sm border border-slate-200 text-xs">
          {pullMsg || syncMsg}
        </div>
      )}
      </div>
    </header>
  );
}