import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { capFrFirstLowerRest, formatFrSpace, formatInt, isoToFr } from "../../utils/format";
import { computeHistoryValuation, normalizeType } from "../../utils/valuation";

const ProductHistoryModal = ({ open, onClose, designation, token, company, seedLines /* fallback list from page */ }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [costMethod, setCostMethod] = useState("fifo");
  const [filterType, setFilterType] = useState("all");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setLines([]);
    setFilterType("all");
    setFilterClientId("");
    setFilterDate("");
    setFilterStart("");
    setFilterEnd("");

    (async () => {
      if (!designation?.name) return;
      setLoading(true);
      try {
        let data = [];
        if (designation.id != null) {
          try {
            const res = await api.get(`/api/stockMouvements?designation_id=${designation.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            data = Array.isArray(res.data) ? res.data : [];
          } catch {
            data = seedLines || [];
          }
          data = data.filter((l) => Number(l.designation_id) === Number(designation.id));
        } else {
          const nameLc = designation.name.toLocaleLowerCase("fr-FR").trim();
          data = (seedLines || []).filter(
            (m) => String(m.designation_name || "").trim().toLocaleLowerCase("fr-FR") === nameLc
          );
        }
        const normalized = data.map((l) => ({
          ...l,
          date: l.date && /^\d{4}-\d{2}-\d{2}$/.test(String(l.date)) ? isoToFr(l.date) : (l.date || ""),
          type: String(l.type || ""),
          client_name: l.client_name ?? "N/A",
          designation_name: l.designation_name ?? designation.name,
        }));
        normalized.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        setLines(normalized);
      } catch {
        setError("Impossible de charger l'historique.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, designation, token, seedLines]);

  const clientOptions = useMemo(() => {
    const map = new Map();
    for (const l of lines) {
      const key = String(l.client_id ?? "NA");
      const name = l.client_name ?? "N/A";
      if (!map.has(key)) map.set(key, name);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base" })
    );
  }, [lines]);

  const tDate = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  };

  const filtered = useMemo(() => {
    const single = tDate(filterDate);
    const start = tDate(filterStart);
    const end = tDate(filterEnd);
    return lines.filter((l) => {
      if (filterType !== "all" && normalizeType(l.type) !== filterType) return false;
      if (filterClientId) {
        const key = String(l.client_id ?? "NA");
        if (key !== filterClientId) return false;
      }
      const t = tDate(l.date);
      if (single != null) {
        if (t !== single) return false;
      } else {
        if (start != null && t < start) return false;
        if (end != null && t > end) return false;
      }
      return true;
    });
  }, [lines, filterType, filterClientId, filterDate, filterStart, filterEnd]);

  const valuation = useMemo(() => computeHistoryValuation(filtered, costMethod), [filtered, costMethod]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4">
        <div className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900">Historique - {capFrFirstLowerRest(designation?.name || "")}</h2>
            <div className="text-sm text-gray-700 flex items-center gap-2">
              <label>Valorisation:</label>
              <select value={costMethod} onChange={(e) => setCostMethod(e.target.value)} className="border rounded px-2 py-1">
                <option value="fifo">FIFO</option>
                <option value="wac">Moyenne pondérée</option>
              </select>
            </div>
          </div>

          {/* Filtres */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Type</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border rounded px-2 py-1">
                <option value="all">Tous</option>
                <option value="entree">Entrée</option>
                <option value="sortie">Sortie</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Client</label>
              <select value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} className="w-full border rounded px-2 py-1">
                <option value="">Tous</option>
                {clientOptions.map((o) => <option key={o.value} value={o.value}>{capFrFirstLowerRest(o.label)}</option>)}
              </select>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Date exacte</label>
              <input type="text" placeholder="jj/mm/aaaa" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-full border rounded px-2 py-1" inputMode="numeric" />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Début</label>
              <input type="text" placeholder="jj/mm/aaaa" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="w-full border rounded px-2 py-1" inputMode="numeric" />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Fin</label>
              <input type="text" placeholder="jj/mm/aaaa" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="w-full border rounded px-2 py-1" inputMode="numeric" />
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-600 mt-3">Chargement...</p>
          ) : error ? (
            <p className="text-sm text-red-600 mt-3">{error}</p>
          ) : (
            <div className="mt-4 overflow-x-auto max-h-[60vh]">
              <table className="min-w-full border border-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2 px-2 border-b text-left w-12">#</th>
                    <th className="py-2 px-3 border-b text-left">Date</th>
                    <th className="py-2 px-3 border-b text-left">Type</th>
                    <th className="py-2 px-3 border-b text-left">Client</th>
                    <th className="py-2 px-3 border-b text-right">Quantité</th>
                    <th className="py-2 px-3 border-b text-right">Prix unitaire</th>
                    <th className="py-2 px-3 border-b text-right">Montant</th>
                    <th className="py-2 px-3 border-b text-right">Achat</th>
                    <th className="py-2 px-3 border-b text-right">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.lines.length === 0 ? (
                    <tr><td colSpan={9} className="py-4 px-3 text-center text-gray-500 italic">Aucun mouvement trouvé.</td></tr>
                  ) : valuation.lines.map((l, i) => (
                    <tr key={`${l.id || i}-${l.date}`} className="hover:bg-gray-50">
                      <td className="py-2 px-2 border-b">{i + 1}</td>
                      <td className="py-2 px-3 border-b">{l.date}</td>
                      <td className="py-2 px-3 border-b">{capFrFirstLowerRest(l.type)}</td>
                      <td className="py-2 px-3 border-b">{capFrFirstLowerRest(l.client_name)}</td>
                      <td className="py-2 px-3 border-b text-right">{formatInt(l.quantite)}</td>
                      <td className="py-2 px-3 border-b text-right">{formatInt(l.prix)}</td>
                      <td className="py-2 px-3 border-b text-right">{formatInt(l._montant ?? l.montant)}</td>
                      <td className="py-2 px-3 border-b text-right">{formatInt(l._achat)}</td>
                      <td className="py-2 px-3 border-b text-right">{formatInt(l._marge)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="py-2 px-3 border-0" colSpan={6}>Totaux</td>
                    <td className="py-2 px-3 border-0 text-right font-semibold">{formatInt(valuation.totals.montant)} F CFA</td>
                    <td className="py-2 px-3 border-0 text-right font-semibold">{formatInt(valuation.totals.achat)} F CFA</td>
                    <td className="py-2 px-3 border-0 text-right font-semibold">{formatInt(valuation.totals.marge)} F CFA</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3">
          <button type="button" className="border bg-white px-4 py-2 rounded hover:bg-gray-50" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
};

export default ProductHistoryModal;