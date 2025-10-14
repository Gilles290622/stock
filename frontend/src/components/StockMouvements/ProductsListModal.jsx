import React, { useEffect, useRef, useState } from "react";
import api from "../../api/axios";

const DEBOUNCE_MS = 250;

export default function ProductsListModal({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const timerRef = useRef();
  const [total, setTotal] = useState(0);
  const [printing, setPrinting] = useState(false);

  const printList = () => {
    try {
      setPrinting(true);
      (async () => {
        try {
          const endpoint = q && q.trim() ? `/api/designations/all?q=${encodeURIComponent(q.trim())}` : '/api/designations/all';
          const resAll = await api.get(endpoint);
          const all = Array.isArray(resAll.data) ? resAll.data : [];
          const prev = items;
          setItems(all);
          setTimeout(() => {
            window.print();
            setItems(prev);
            setPrinting(false);
          }, 50);
        } catch (_) {
          setTimeout(() => { window.print(); setPrinting(false); }, 0);
        }
      })();
    } catch (_) { setPrinting(false); }
  };

  useEffect(() => {
    if (!open) return;
    setItems([]); setError(""); setLoading(true); setQ(""); setTotal(0);
    (async () => {
      try {
        const res = await api.get("/api/designations/all");
        setItems(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setError(err?.response?.data?.error || "Erreur de chargement");
      } finally { setLoading(false); }
      try {
        const cnt = await api.get("/api/designations/count");
        setTotal(Number(cnt?.data?.count || 0));
      } catch (_) { /* ignore count errors */ }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!q.trim()) {
        try {
          setLoading(true); setError("");
          const res = await api.get("/api/designations/all");
          setItems(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
          setItems([]); setError(err?.response?.data?.error || "Erreur de chargement");
        } finally { setLoading(false); }
        try {
          const cnt = await api.get("/api/designations/count");
          setTotal(Number(cnt?.data?.count || 0));
        } catch (_) { setTotal(0); }
        return;
      }
      try {
        setLoading(true); setError("");
        const res = await api.get(`/api/designations/search?q=${encodeURIComponent(q.trim())}`);
        setItems(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setItems([]); setError(err?.response?.data?.error || "Erreur de recherche"); setTotal(0);
      } finally { setLoading(false); }
      try {
        const cnt = await api.get(`/api/designations/count?q=${encodeURIComponent(q.trim())}`);
        setTotal(Number(cnt?.data?.count || 0));
      } catch (_) { setTotal(0); }
    }, DEBOUNCE_MS);
    return () => timerRef.current && clearTimeout(timerRef.current);
  }, [q, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" role="dialog" aria-modal="true" style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(1.5px)" }}>
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-2 mt-8">
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Liste des produits { !loading ? `(${total || items.length || 0})` : ''}</h2>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100 text-gray-500" aria-label="Fermer">×</button>
          </div>
          <div className="mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit" className="border rounded px-3 py-2 w-full" />
          </div>
          {loading && <div className="text-gray-600">Chargement…</div>}
          {error && <div className="text-red-600">{error}</div>}
          <div className="max-h-[60vh] overflow-y-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Désignation</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-3 text-center text-gray-500 italic">Aucun produit</td>
                  </tr>
                ) : items.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{d.name}</td>
                    <td className="px-3 py-2 text-right">{d.current_stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 pb-6 mt-4 flex items-center justify-end gap-3">
          <button
            className="border bg-white px-4 py-2 rounded hover:bg-gray-50"
            onClick={printList}
            disabled={loading || (items?.length || 0) === 0}
            title="Imprimer la liste"
          >Imprimer</button>
          <button className="border bg-white px-4 py-2 rounded hover:bg-gray-50" onClick={onClose}>Fermer</button>
        </div>
      </div>
      {printing && (
        <div id="print-products" data-print-area>
          <style>
            {`@media print {
              body * { visibility: hidden !important; }
              #print-products, #print-products * { visibility: visible !important; }
              #print-products { position: absolute; left: 0; top: 0; width: 100%; padding: 12px; }
              .no-print { display: none !important; }
            }`}
          </style>
          <div style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
            <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Liste des produits ({total || items.length || 0})</h1>
            <div style={{ color:'#444', fontSize:12, marginBottom: 10 }}>
              Généré le {new Date().toLocaleString()}{q ? ` — Filtre: ${q}` : ''}
            </div>
            <table style={{ borderCollapse:'collapse', width:'100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', background:'#f5f5f5', border:'1px solid #ddd', padding:6 }}>Désignation</th>
                  <th style={{ textAlign:'right', background:'#f5f5f5', border:'1px solid #ddd', padding:6 }}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {(items && items.length > 0) ? items.map((d) => (
                  <tr key={d.id}>
                    <td style={{ padding:6, border:'1px solid #ddd' }}>{d.name || ''}</td>
                    <td style={{ padding:6, border:'1px solid #ddd', textAlign:'right' }}>{d.current_stock ?? 0}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={2} style={{ padding:8, textAlign:'center', color:'#777' }}>Aucun produit</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
