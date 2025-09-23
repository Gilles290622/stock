import React, { useEffect, useRef, useState } from "react";
import api from "../../api/axios";

const DEBOUNCE_MS = 250;

export default function ClientsListModal({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const timerRef = useRef();

  useEffect(() => {
    if (!open) return;
    setItems([]); setError(""); setLoading(true); setQ("");
    (async () => {
      try {
        const res = await api.get("/api/clients");
        setItems(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setError(err?.response?.data?.error || "Erreur de chargement");
      } finally { setLoading(false); }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!q.trim()) {
        // recharger la liste par défaut
        try {
          setLoading(true); setError("");
          const res = await api.get("/api/clients");
          setItems(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
          setItems([]); setError(err?.response?.data?.error || "Erreur de chargement");
        } finally { setLoading(false); }
        return;
      }
      try {
        setLoading(true); setError("");
        const res = await api.get(`/api/clients/search?q=${encodeURIComponent(q.trim())}`);
        setItems(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setItems([]); setError(err?.response?.data?.error || "Erreur de recherche");
      } finally { setLoading(false); }
    }, DEBOUNCE_MS);
    return () => timerRef.current && clearTimeout(timerRef.current);
  }, [q, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" role="dialog" aria-modal="true" style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(1.5px)" }}>
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-2 mt-8">
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Liste des clients</h2>
            <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100 text-gray-500" aria-label="Fermer">×</button>
          </div>
          <div className="mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client" className="border rounded px-3 py-2 w-full" />
          </div>
          {loading && <div className="text-gray-600">Chargement…</div>}
          {error && <div className="text-red-600">{error}</div>}
          <div className="max-h-[60vh] overflow-y-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Contact</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-3 text-center text-gray-500 italic">Aucun client</td>
                  </tr>
                ) : items.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.contact || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 pb-6 mt-4 flex items-center justify-end gap-3">
          <button className="border bg-white px-4 py-2 rounded hover:bg-gray-50" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
