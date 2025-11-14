import React, { useEffect, useState } from 'react';
import api from '../api/axios';

function resolveAssetPath(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
  const baseNoSlash = base.replace(/\/$/, '');
  if (p === '/default-avatar.svg') p = '/stock/default-avatar.svg';
  if (p.startsWith(baseNoSlash + '/')) return p;
  if (p.startsWith('/')) return baseNoSlash + p;
  return base + p;
}

export default function DebugAvatar({ user }) {
  const [listing, setListing] = useState([]);
  const [err, setErr] = useState('');
  const raw = user?.logo || '';
  const resolved = resolveAssetPath(raw || '/default-avatar.svg');
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const { data } = await api.get('/api/upload-logo-list');
        if (stop) return;
        if (Array.isArray(data)) setListing(data);
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Erreur listing');
      }
    })();
    return () => { stop = true; };
  }, []);
  return (
    <div className="max-w-xl mx-auto mt-6 p-4 bg-white rounded shadow space-y-4 text-sm">
      <h2 className="text-lg font-semibold">Debug Avatar</h2>
      <div className="space-y-1">
        <div><b>Raw:</b> <code>{raw || '(vide)'}</code></div>
        <div><b>Résolu:</b> <code>{resolved}</code></div>
        <div className="flex items-center gap-4">
          <img src={resolved} alt="Avatar" className="h-20 w-20 rounded-full border object-cover" onError={(e)=>{e.target.src=resolveAssetPath('/default-avatar.svg')}} />
          <div className="text-xs text-slate-600">Si l'image ne s'affiche pas et qu'elle n'est pas la valeur par défaut, vérifier que le fichier figure dans le listing ci-dessous.</div>
        </div>
      </div>
      <div>
        <b>Listing /api/upload-logo-list:</b>
        {err && <div className="text-red-600">{err}</div>}
        {!err && !listing.length && <div className="text-slate-500">(vide ou accès refusé)</div>}
        {listing.length > 0 && (
          <ul className="list-disc pl-5 max-h-48 overflow-y-auto">
            {listing.map(f => <li key={f}>{f}</li>)}
          </ul>
        )}
      </div>
      <div className="text-xs text-slate-500">Route temporaire de diagnostic. Retirer en production si inutile.</div>
    </div>
  );
}
