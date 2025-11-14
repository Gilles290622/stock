import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { pullAllSource, pushAllSSE, pullAllSSE } from '../api/sync';

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
  const [subInfo, setSubInfo] = useState({ days: null, expires: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setEntreprise(initialEntreprise || ''); }, [initialEntreprise]);

  // En environnement online, certains anciens serveurs ne renvoient pas entreprise dans /api/me.
  // Récupérer le nom d'entreprise via /api/entreprise quand il est manquant.
  useEffect(() => {
    let cancelled = false;
    async function fetchEnt() {
      try {
        if (!entreprise && (userId || username)) {
          const { data } = await api.get('/api/entreprise');
          if (!cancelled && data && typeof data.entreprise === 'string' && data.entreprise.trim() !== '') {
            const ent = data.entreprise.trim();
            setEntreprise(ent);
            if (onEntrepriseChange) {
              try { onEntrepriseChange(ent); } catch {}
            }
          }
        }
      } catch { /* tolérant */ }
    }
    fetchEnt();
    return () => { cancelled = true; };
  }, [entreprise, userId, username]);

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

  // Charger les infos d'abonnement pour afficher un badge de jours restants
  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const { data } = await api.get('/api/me');
        if (cancelled) return;
        const user = data?.user || {};
        const exp = user.subscription_expires ? new Date(user.subscription_expires) : null;
        let days = null;
        if (exp && !isNaN(exp)) {
          const diff = exp - Date.now();
          days = Math.max(0, Math.ceil(diff / (1000*60*60*24)));
        } else if (user.free_days) {
          const d = parseInt(user.free_days, 10);
          if (!isNaN(d)) days = d;
        }
        setSubInfo({ days, expires: user.subscription_expires || null });
      } catch (_) {
        // ignore
      }
    }
    loadMe();
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
        // notifier les vues (liste flux, etc.)
        try { window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { source: 'sync' } })); } catch {}
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
        // notifier les vues (liste flux, etc.)
        try { window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { source: 'import' } })); } catch {}
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
    const baseNoSlash = base.replace(/\/$/, '');
    // Normaliser avatar par défaut
    if (p === '/default-avatar.svg') p = '/stock/default-avatar.svg';
    // Si déjà préfixé correctement (ex: '/stock/avatars/x.png' alors que base='/stock/') ne pas dupliquer
    if (p.startsWith(baseNoSlash + '/')) return p;
    if (p.startsWith('/')) return baseNoSlash + p; // ajouter base s'il manque
    return base + p; // chemin relatif
  }
  const appLogo = resolveAssetPath('logo.png');
  const appFavicon = resolveAssetPath('favicon.png');

  function handleQuit() {
    try {
      // Tentative standard (fonctionne mieux en mode app Chrome/Edge)
      window.close();
    } catch (_) {}
    // Fallback: tenter la fermeture via _self, sinon basculer sur about:blank
    setTimeout(() => {
      try { const w = window.open('', '_self'); if (w) w.close(); } catch (_) {}
      // Dernier recours: vider l'écran
      try { window.location.replace('about:blank'); } catch (_) {}
    }, 200);
  }
  function toggleMenu() { setMenuOpen(v => !v); }
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);
  useEffect(() => {
    function onClickOutside(e){
      try {
        if (menuRef.current && !menuRef.current.contains(e.target)) {
          setMenuOpen(false);
        }
      } catch {}
    }
    if (menuOpen) {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('touchstart', onClickOutside, { passive: true });
      return () => {
        document.removeEventListener('mousedown', onClickOutside);
        document.removeEventListener('touchstart', onClickOutside);
      };
    }
  }, [menuOpen]);
  return (
    <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/80 bg-white border-b border-slate-200 text-slate-800">
      <div className="relative max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
        {/* Bloc gauche: logo + titre + entreprise + numéro */}
        <div className="flex items-center gap-4 min-w-0">
          {/* Avatar + username (gauche) */}
          {isAuthenticated && (
            <div className="relative flex flex-col items-center -ml-1">
              <div
                className={`group flex items-center justify-center h-11 w-11 rounded-full border transition ${'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                title="Utilisateur"
              >
                <img
                  src={resolveAssetPath(userLogo || '/default-avatar.svg')}
                  alt="Avatar utilisateur"
                  className="h-10 w-10 rounded-full object-cover"
                  onError={(e)=>{
                    try {
                      const attempted = e.target.getAttribute('data-attempted') || '0';
                      const currentSrc = e.target.getAttribute('src') || '';
                      // Séquence de fallback avant avatar par défaut:
                      // 1) Si src contient '/stock/uploads/' essayer sans '/stock'
                      if (attempted === '0' && /\/stock\/uploads\//.test(currentSrc)) {
                        e.target.setAttribute('data-attempted','1');
                        e.target.src = currentSrc.replace(/\/stock\/uploads\//,'/uploads/');
                        return;
                      }
                      // 2) Si src commence par '/uploads/' essayer avec '/stock/uploads/'
                      if (attempted === '1' && /\/uploads\//.test(currentSrc) && !/\/stock\/uploads\//.test(currentSrc)) {
                        e.target.setAttribute('data-attempted','2');
                        e.target.src = currentSrc.replace(/\/uploads\//,'/stock/uploads/');
                        return;
                      }
                      // 3) Dernier recours: avatar par défaut
                      e.target.setAttribute('data-attempted','3');
                      e.target.src = resolveAssetPath('/default-avatar.svg');
                    } catch {}
                  }}
                />
              </div>
              <div className="mt-1 max-w-[72px] text-[10px] leading-tight font-medium text-slate-700 text-center truncate" title={username || 'Utilisateur'}>
                {username || 'Utilisateur'}
              </div>
            </div>
          )}
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
          {/* menu open block removed from left; now anchored in right */}
          {isAuthenticated && userNumber && (
            <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-medium ml-2 border border-slate-200">
              N° {userNumber}
            </span>
          )}
        </div>
        {/* Bloc droit: actions synchronisation et badges */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {isAuthenticated ? (
            <>
              {/* Badge jours restants: seulement <= 3 jours */}
              {!isAdmin && (typeof subInfo.days === 'number') && subInfo.days <= 3 && (
                <span
                  className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    subInfo.days <= 3
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : (subInfo.days <= 7
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200')
                  }`}
                  title={subInfo.expires ? `Expire le ${subInfo.expires}` : 'Jours restants'}
                >{subInfo.days <= 0 ? 'Expiré' : `Restant: ${subInfo.days} j`}</span>
              )}
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
              {/* Bouton Menu (droite) */}
              <div ref={menuRef} className="relative flex flex-col items-center">
                <button
                  type="button"
                  onClick={toggleMenu}
                  className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-green-300 ${menuOpen ? 'bg-green-50 text-green-700' : 'bg-white text-slate-700 hover:bg-green-50 hover:text-green-700'}`}
                  title="Menu utilisateur"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen ? 'true' : 'false'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 icon-accent" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M3 5h14a1 1 0 100-2H3a1 1 0 100 2zm14 4H3a1 1 0 000 2h14a1 1 0 100-2zm0 6H3a1 1 0 000 2h14a1 1 0 100-2z" clipRule="evenodd" />
                  </svg>
                  Menu
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-md shadow-lg z-50">
                    <div className="py-1">
                      {!isAdmin && (
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                          onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                        >Profil</button>
                      )}
                      {!isAdmin && (
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                          onClick={() => { setMenuOpen(false); navigate('/pay'); }}
                        >Payer</button>
                      )}
                      {isAdmin && (
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                          onClick={() => { setMenuOpen(false); navigate('/admin'); }}
                        >Admin</button>
                      )}
                      <div className="my-1 border-t border-slate-200" />
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                        onClick={() => { setMenuOpen(false); onLogout && onLogout(); }}
                      >Déconnexion</button>
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50"
                        onClick={() => { setMenuOpen(false); handleQuit(); }}
                      >Quitter</button>
                    </div>
                  </div>
                )}
              </div>
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
      </div>
      {(syncMsg || pullMsg) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-[60px] mt-2 bg-slate-50 text-slate-700 px-3 py-1 rounded-md shadow-sm border border-slate-200 text-xs">
          {pullMsg || syncMsg}
        </div>
      )}
      {/* Dropdown global supprimé (désormais ancré sous l'avatar) */}
    </header>
  );
}