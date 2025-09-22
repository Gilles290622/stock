import React, { useRef, useState, useEffect } from "react";
import api from "../../api/axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const DEBOUNCE_MS = 200;

const ModalHistoriqueRecherche = ({
  open,
  onClose,
  onEdit = () => {},
  onDelete = () => {},
  onUpdateType = null, // optional: called with updated item when select type changes
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState(null);
  const searchDebounceRef = useRef();
  const tableRef = useRef();

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setFeed([]);
      setError("");
      setLoading(false);
      setPdfUrl(null);
    }
  }, [open]);

  const fetchRechercheFeed = async (value) => {
    if (!value.trim()) {
      setFeed([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const t = localStorage.getItem("token");
      const params = new URLSearchParams();
      params.append("searchQuery", value.trim());
      const url = `/api/stockFlux/search?` + params.toString();
      const res = await api.get(url, { headers: { Authorization: `Bearer ${t}` } });
      setFeed(Array.isArray(res.data.flux) ? res.data.flux : []);
      setError("");
    } catch (err) {
      setFeed([]);
      setError(err?.response?.data?.error || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchRechercheFeed(value);
    }, DEBOUNCE_MS);
  };

  // Génération du PDF
  const handleGeneratePdf = async () => {
    const input = tableRef.current;
    if (!input) return;
    const canvas = await html2canvas(input, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("l", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgWidth = pageWidth - 40;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    pdf.addImage(imgData, "PNG", 20, 20, imgWidth, imgHeight, "", "FAST");
    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    pdf.save("historique.pdf");
  };

  const getWhatsappLink = () => {
    let txt = `Historique des mouvements`;
    if (searchQuery.trim()) txt += ` (Recherche: ${searchQuery.trim()})`;
    txt += "\n";
    feed.forEach((item, idx) => {
      txt += `#${idx + 1} - ${item.date} - ${item.type} - ${item.designation_name} (${item.quantite || "-"} x ${item.prix || "-"}) Client: ${item.client_name || "-"} Montant: ${item.montant}\n`;
    });
    if (pdfUrl) txt += `\nPDF: ${pdfUrl}`;
    return `https://wa.me/?text=${encodeURIComponent(txt)}`;
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(1.5px)" }}
    >
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-2 print:max-w-full print:shadow-none print:rounded-none print:m-0">
        <h1 className="hidden print:block text-center font-bold my-6 print:text-2xl">
          Historique des mouvements
          {searchQuery.trim() && (
            <span className="block text-base font-normal mt-2">Recherche&nbsp;: {searchQuery.trim()}</span>
          )}
        </h1>

        <div className="px-6 pt-6 print:px-4">
          <div className="flex items-center justify-between mb-2 print:hidden">
            <h2 className="text-lg font-semibold text-gray-900">Recherche de mouvements (Historique)</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1 hover:bg-gray-100 text-gray-500"
              title="Fermer"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>

          <div className="flex gap-2 mb-3 print:hidden">
            <input
              type="text"
              value={searchQuery}
              onInput={handleInput}
              className="border rounded px-4 py-2 w-full"
              placeholder="Recherche client, désignation ou date"
              autoFocus
              autoComplete="off"
            />
            <button
              onClick={() => window.print()}
              className="px-3 py-2 rounded bg-gray-700 text-white hover:bg-black print:hidden"
              title="Imprimer"
            >
              🖨️
            </button>
            <button
              onClick={handleGeneratePdf}
              className="px-3 py-2 rounded bg-fuchsia-700 text-white hover:bg-fuchsia-900"
              title="Exporter en PDF"
            >
              PDF
            </button>
            <a
              href={getWhatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
              title="Partager sur WhatsApp"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.52 3.48A11.93 11.93 0 0012.05 0C5.52 0 .05 5.47.05 12c0 2.11.55 4.18 1.61 6.01L0 24l6.24-1.63A11.92 11.92 0 0012.05 24c6.53 0 11.9-5.47 11.9-12.01 0-3.19-1.25-6.19-3.43-8.51zM12.05 22c-1.93 0-3.81-.5-5.46-1.45l-.39-.23-3.71.97.99-3.61-.25-.38A9.94 9.94 0 012.05 12c0-5.5 4.5-9.99 10-9.99 5.51 0 9.99 4.49 9.99 9.99 0 5.51-4.48 10-9.99 10zm5.48-7.27c-.3-.15-1.76-.87-2.03-.97-.27-.1-.46-.15-.65.16-.2.3-.75.97-.92 1.17-.17.2-.34.22-.64.08-.3-.15-1.27-.47-2.41-1.5-.89-.8-1.49-1.79-1.66-2.09-.17-.3-.02-.46.13-.6.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.38-.03-.53-.08-.15-.65-1.56-.89-2.14-.23-.55-.47-.48-.65-.49h-.56c-.2 0-.52.07-.79.3-.27.23-1.04 1.02-1.04 2.48s1.07 2.86 1.22 3.06c.15.2 2.1 3.2 5.09 4.36.71.24 1.26.38 1.69.48.7.15 1.34.13 1.85.08.56-.06 1.76-.72 2.01-1.41.25-.68.25-1.27.17-1.41-.08-.14-.28-.22-.59-.36z"></path>
              </svg>
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          </div>

          {loading && <div className="text-gray-600 mb-2">Chargement…</div>}
          {error && <div className="text-red-600 mb-2">{error}</div>}

          <div className="overflow-x-auto">
            <table
              ref={tableRef}
              className="min-w-full border shadow rounded-xl overflow-hidden print:w-full print:shadow-none print:rounded-none print:text-black print:bg-white text-base print:text-2xl"
            >
              <thead className="bg-gray-100 print:bg-white">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Désignation</th>
                  <th className="px-2 py-2 text-left">Qté</th>
                  <th className="px-2 py-2 text-left">Prix</th>
                  <th className="px-2 py-2 text-left">Client</th>
                  <th className="px-2 py-2 text-left">Montant</th>
                  <th className="px-2 py-2 text-left print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50 text-base print:hover:bg-white print:text-2xl">
                    <td className="px-2 py-2 font-mono text-gray-500">{idx + 1}</td>
                    <td className="px-2 py-2">{item.date}</td>
                    <td className="px-2 py-2">
                      <select
                        className="border rounded px-2 py-1 min-w-[80px] print:border-none print:bg-transparent print:text-black"
                        value={item.type}
                        onChange={(e) => {
                          const updated = { ...item, type: e.target.value };
                          // prefer onUpdateType (direct patch), fallback to onEdit(updated)
                          if (typeof onUpdateType === "function") onUpdateType(updated);
                          else onEdit(updated);
                        }}
                        disabled={loading}
                      >
                        <option value="entree">Entrée</option>
                        <option value="sortie">Sortie</option>
                        <option value="depense">Dépense</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">{item.designation_name}</td>
                    <td className="px-2 py-2">{item.quantite ?? "-"}</td>
                    <td className="px-2 py-2">{item.prix ?? "-"}</td>
                    <td className="px-2 py-2">{item.client_name}</td>
                    <td className="px-2 py-2">{item.montant}</td>
                    <td className="px-2 py-2 space-x-2 print:hidden">
                      <button
                        onClick={() => onEdit(item)}
                        className="px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs"
                      >
                        Éditer
                      </button>
                      <button
                        onClick={() => onDelete(item)}
                        className="px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 text-xs"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && !feed.length && searchQuery.trim() && (
                  <tr>
                    <td colSpan={9} className="text-gray-400 py-4 text-center">
                      Aucun résultat
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 pb-6 flex items-center justify-end gap-3 print:hidden">
          <button
            type="button"
            className="border bg-white px-4 py-2 rounded hover:bg-gray-50"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalHistoriqueRecherche;