import React, { useEffect, useState, useRef } from "react";
import api from "../../api/axios";

function Spinner() { /* ... inchangé ... */ }
function Modal({ open, onClose, title = "", children }) { /* ... inchangé ... */ }

export default function ClientReleveModal({ open, onClose, token }) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [loading, setLoading] = useState(false);
  const [releve, setReleve] = useState([]);
  const [error, setError] = useState("");
  const searchTimeout = useRef(null);

  // Reset tout à la fermeture
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSearchResults([]);
      setSelectedClient(null);
      setReleve([]);
      setError("");
    }
  }, [open]);

  // Recherche client
  useEffect(() => {
    if (!open) return;
    if (!search.trim()) {
      setSearchResults([]);
      setSelectedClient(null);
      setReleve([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      api
        .get(`/clients/search?q=${encodeURIComponent(search)}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .then(res => setSearchResults(res.data || []))
        .catch(() => setSearchResults([]));
    }, 200);
    return () => clearTimeout(searchTimeout.current);
  }, [search, open, token]);

  // Dès qu'on choisit un client, fetch les mouvements
  useEffect(() => {
    if (selectedClient?.id) {
      setLoading(true);
      setError("");
      api
        .get(`/clients/${selectedClient.id}/releve`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .then(res => setReleve(res.data || []))
        .catch((err) => {
          setError(err?.response?.data?.error || "Erreur serveur");
          setReleve([]);
        })
        .finally(() => setLoading(false));
    } else {
      setReleve([]);
    }
  }, [selectedClient, token]);

  function handlePrint() {
    if (!selectedClient) return;
    const printContent = document.getElementById("releve-print-section").innerHTML;
    const win = window.open("", "_blank");
    win.document.write(`
      <html>
        <head>
          <title>Relevé client - ${selectedClient.name}</title>
          <style>
            body { font-family: sans-serif; margin: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #777; padding: 6px; font-size: 12px; }
            th { background: #f0f0f0; }
            .text-right { text-align: right; }
            .font-bold { font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>Relevé du client&nbsp;: ${selectedClient.name}</h2>
          ${printContent}
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  function handleShare() {
    if (!navigator.share || !selectedClient) {
      alert("Le partage direct n'est pas supporté sur ce navigateur.");
      return;
    }
    const txt = `Relevé du client ${selectedClient.name}\n\n` +
      releve.map(row =>
        `${row.date} | ${row.type} | ${row.designation || ""} | ${row.montant} | ${row.mode_paiement || ""} | ${row.observation || ""} | Balance: ${row.balance} | Solde: ${row.solde}`
      ).join('\n');
    navigator.share({ title: `Relevé - ${selectedClient.name}`, text: txt });
  }

  return (
    <Modal open={open} onClose={onClose} title="Relevé client">
      {/* Pas de <form> autour ! */}
      <div>
        <label className="block mb-1 font-semibold">Rechercher un client :</label>
        <input
          className="border px-3 py-2 rounded w-full"
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setSelectedClient(null);
            setReleve([]);
          }}
          onKeyDown={e => {
            // Empêche tout submit implicite sur Entrée
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Tapez le nom du client"
          autoFocus
        />
        {search.length > 0 && searchResults.length > 0 && !selectedClient && (
          <ul className="border rounded mt-1 max-h-40 overflow-y-auto bg-white absolute z-10 w-full">
            {searchResults.map(cli => (
              <li
                key={cli.id}
                className="px-3 py-2 hover:bg-blue-100 cursor-pointer"
                tabIndex={0}
                onClick={() => {
                  setSelectedClient(cli);
                  setSearch(cli.name);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedClient(cli);
                    setSearch(cli.name);
                  }
                }}
                role="option"
                aria-selected={false}
              >
                {cli.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-6">
        {selectedClient && (
          <div className="mb-3 font-semibold">
            Relevé pour <span className="text-blue-700">{selectedClient.name}</span>
          </div>
        )}
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="text-red-600 my-4">{error}</div>
        ) : (
          selectedClient && (
            <div id="releve-print-section" className="overflow-x-auto max-h-[60vh]">
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 border">Date</th>
                    <th className="p-2 border">Type</th>
                    <th className="p-2 border">Désignation</th>
                    <th className="p-2 border">Montant</th>
                    {/* Colonnes retirées côté backend */}
                    <th className="p-2 border">Balance</th>
                    <th className="p-2 border">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {releve.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-4">Aucun mouvement pour ce client.</td>
                    </tr>
                  )}
                  {releve.map((row) => (
                    <tr key={row.id}>
                      <td className="p-2 border">{row.date}</td>
                      <td className="p-2 border">{row.type}</td>
                      <td className="p-2 border">{row.designation || ""}</td>
                      <td className="p-2 border text-right">{row.montant?.toLocaleString()}</td>
                      {/* Colonnes retirées */}
                      <td className="p-2 border text-right">{row.balance?.toLocaleString()}</td>
                      <td className="p-2 border text-right font-bold">{row.solde?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      <div className="mt-4 text-right flex gap-2 justify-end">
        <button
          type="button"
          className="px-4 py-2 rounded bg-blue-600 text-white"
          onClick={onClose}
        >Fermer</button>
        {selectedClient && releve.length > 0 && (
          <>
            <button
              type="button"
              className="px-4 py-2 rounded bg-green-700 text-white"
              onClick={handlePrint}
              title="Imprimer"
            >Imprimer</button>
            <button
              type="button"
              className="px-4 py-2 rounded bg-blue-500 text-white"
              onClick={handleShare}
              title="Partager"
            >Partager</button>
          </>
        )}
      </div>
    </Modal>
  );
}