import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import { capFrFirstLowerRest, formatInt, frToIso, getTodayFr } from "../../utils/format";
import { normalizeType } from "../../utils/valuation";

const PaymentModal = ({ open, onClose, mouvement, token }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ date: getTodayFr(), amount: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ date: "", amount: "" });
  const [rowLoadingId, setRowLoadingId] = useState(null);

  const totals = useMemo(() => {
    const totalPaid = list.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const mvAmount = mouvement ? Number(mouvement.montant) || 0 : 0;
    const reste = Math.max(mvAmount - totalPaid, 0);
    return { totalPaid, reste, mvAmount };
  }, [list, mouvement]);

  useEffect(() => {
    if (!open || !mouvement) return;
    setError("");
    setList([]);
    setForm({ date: getTodayFr(), amount: "" });
    setEditingId(null);
    setEditForm({ date: "", amount: "" });

    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/stockPaiements?mouvement_id=${mouvement.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const rows = Array.isArray(res.data) ? res.data : [];
        const normalized = rows.map((r) => ({
          ...r,
          date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))
            ? r.date.split("-").reverse().join("/")
            : (r.date || ""),
          montant: Number(r.montant) || 0,
          user_name: r.user_name || "",
        }));
        setList(normalized);

        const totalPaid = normalized.reduce((s, p) => s + (Number(p.montant) || 0), 0);
        const mvAmount = Number(mouvement.montant) || 0;
        const reste = Math.max(mvAmount - totalPaid, 0);
        setForm({ date: getTodayFr(), amount: reste > 0 ? reste : mvAmount });
      } catch (err) {
        setError(err?.response?.data?.error || "Impossible de charger les paiements.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, mouvement, token]);

  // Réutilisable: recharge la liste + met à jour le champ "amount" avec le reste
  const refreshListAndRemainder = async () => {
    const res = await api.get(`/api/stockPaiements?mouvement_id=${mouvement.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    const normalized = rows.map((r) => ({
      ...r,
      date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))
        ? r.date.split("-").reverse().join("/")
        : (r.date || ""),
      montant: Number(r.montant) || 0,
    }));
    setList(normalized);

    const totalPaid = normalized.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const mvAmount = Number(mouvement.montant) || 0;
    const reste = Math.max(mvAmount - totalPaid, 0);
    setForm((f) => ({ ...f, amount: reste }));
  };

  const submitPayment = async (e) => {
    e?.preventDefault();
    if (!mouvement || loading) return;
    const iso = frToIso(String(form.date || ""));
    const amount = Number(String(form.amount).replace(/\s/g, "").replace(",", ".")) || 0;
    if (!iso) return setError("Date invalide. Utilisez JJ/MM/AAAA.");
    if (amount <= 0) return setError("Montant à payer invalide (> 0).");

    try {
      setLoading(true);
      await api.post("/api/stockPaiements", {
        mouvement_id: mouvement.id,
        date: iso,
        montant: amount,
      }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

      await refreshListAndRemainder();
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || "Enregistrement du paiement impossible.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({ date: p.date || getTodayFr(), amount: String(p.montant ?? "") });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm({ date: "", amount: "" }); };

  const saveEdit = async () => {
    if (!editingId) return;
    const iso = frToIso(String(editForm.date || ""));
    const amount = Number(String(editForm.amount).replace(/\s/g, "").replace(",", ".")) || 0;
    if (!iso) return setError("Date invalide. Utilisez JJ/MM/AAAA.");
    if (amount <= 0) return setError("Montant invalide (> 0).");
    try {
      setRowLoadingId(editingId);
      await api.patch(`/api/stockPaiements/${editingId}`, { date: iso, montant: amount }, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      });

      await refreshListAndRemainder();
      cancelEdit();
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || "Mise à jour du paiement impossible.");
    } finally {
      setRowLoadingId(null);
    }
  };

  const del = async (id) => {
    if (!id) return;
    const ok = window.confirm("Supprimer ce paiement ?");
    if (!ok) return;
    try {
      setRowLoadingId(id);
      await api.delete(`/api/stockPaiements/${id}`, { headers: { Authorization: `Bearer ${token}` } });

      await refreshListAndRemainder();
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || "Suppression du paiement impossible.");
    } finally {
      setRowLoadingId(null);
    }
  };

  if (!open || !mouvement) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {normalizeType(mouvement.type) === "sortie"
              ? `Règlement facture — ${capFrFirstLowerRest(mouvement.client_name)}`
              : `Règlement approvisionnement — ${capFrFirstLowerRest(mouvement.client_name)}`}
          </h2>

          <div className="mt-3 text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div><span className="text-gray-500">Date mouvement:</span> {mouvement.date}</div>
              <div><span className="text-gray-500">Type:</span> {capFrFirstLowerRest(mouvement.type)}</div>
              <div><span className="text-gray-500">Désignation:</span> {capFrFirstLowerRest(mouvement.designation_name)}</div>
            </div>
            <div className="md:text-right">
              <div><span className="text-gray-500">Montant mouvement:</span> <strong className="tabular-nums">{formatInt(totals.mvAmount)} F CFA</strong></div>
              <div><span className="text-gray-500">Déjà payé:</span> <strong className="tabular-nums">{formatInt(totals.totalPaid)} F CFA</strong></div>
              <div><span className="text-gray-500">Reste à payer:</span> <strong className="tabular-nums text-green-700">{formatInt(totals.reste)} F CFA</strong></div>
            </div>
          </div>

          <form className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={submitPayment}>
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Date paiement</label>
              <input
                type="text"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                placeholder="jj/mm/aaaa"
                className="w-full border rounded px-3 py-2"
                inputMode="numeric"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Montant à payer (F CFA)</label>
              <input
                type="text"
                value={String(form.amount ?? "")}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d\s.,]/g, "");
                  setForm((p) => ({ ...p, amount: v }));
                }}
                className="w-full border rounded px-3 py-2 text-right"
                inputMode="decimal"
              />
            </div>
            <div className="md:col-span-1 flex items-end justify-end gap-2">
              <button
                type="button"
                className="border px-4 py-2 rounded hover:bg-gray-50"
                onClick={() => setForm((p) => ({ ...p, amount: totals.reste }))}
                disabled={loading}
                title="Saisir le reste à payer"
              >
                Solder
              </button>
              <button
                type="submit"
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                disabled={loading}
                title="Enregistrer le paiement"
              >
                {loading ? "Enregistrement..." : "Payer"}
              </button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto max-h-[40vh]">
            <table className="min-w-full border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="py-2 px-3 border-b text-left w-12">#</th>
                  <th className="py-2 px-3 border-b text-left">Date</th>
                  <th className="py-2 px-3 border-b text-right">Montant</th>
                  <th className="py-2 px-3 border-b text-left w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-3 px-3 text-gray-500">
                      Chargement...
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 px-3 text-gray-500 italic">
                      Aucun paiement.
                    </td>
                  </tr>
                ) : (
                  list.map((p, i) => {
                    const editing = editingId === p.id;
                    const rowBusy = rowLoadingId === p.id;
                    return (
                      <tr key={p.id || i} className="hover:bg-gray-50">
                        <td className="py-2 px-3 border-b">{i + 1}</td>

                        <td className="py-2 px-3 border-b">
                          {editing ? (
                            <input
                              type="text"
                              value={editForm.date}
                              onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                              placeholder="jj/mm/aaaa"
                              className="border rounded px-2 py-1 w-36"
                              inputMode="numeric"
                              disabled={rowBusy}
                            />
                          ) : (
                            p.date
                          )}
                        </td>

                        <td className="py-2 px-3 border-b text-right">
                          {editing ? (
                            <input
                              type="text"
                              value={editForm.amount}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d\s.,]/g, "");
                                setEditForm((f) => ({ ...f, amount: v }));
                              }}
                              className="border rounded px-2 py-1 w-32 text-right"
                              inputMode="decimal"
                              disabled={rowBusy}
                            />
                          ) : (
                            `${formatInt(p.montant)} F CFA`
                          )}
                        </td>

                        <td className="py-2 px-3 border-b">
                          {editing ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="bg-green-600 text-white px-3 py-1 rounded text-sm"
                                onClick={saveEdit}
                                disabled={rowBusy}
                                title="Enregistrer"
                              >
                                {rowBusy ? "..." : "Enregistrer"}
                              </button>
                              <button
                                type="button"
                                className="border px-3 py-1 rounded text-sm hover:bg-gray-50"
                                onClick={cancelEdit}
                                disabled={rowBusy}
                                title="Annuler"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="border px-3 py-1 rounded text-sm hover:bg-gray-50"
                                onClick={() => startEdit(p)}
                                disabled={loading}
                                title="Modifier"
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="bg-red-600 text-white px-3 py-1 rounded text-sm"
                                onClick={() => del(p.id)}
                                disabled={rowBusy}
                                title="Supprimer"
                              >
                                {rowBusy ? "..." : "Supprimer"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td className="py-2 px-3 border-0" colSpan={2}>
                    Total payé
                  </td>
                  <td className="py-2 px-3 border-0 text-right font-semibold">
                    {formatInt(totals.totalPaid)} F CFA
                  </td>
                  <td className="py-2 px-3 border-0"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="border bg-white px-4 py-2 rounded hover:bg-gray-50"
            onClick={onClose}
            disabled={loading}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;