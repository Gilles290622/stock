import React, { useEffect, useState } from "react";
import api from "../../api/axios";
import { formatInt } from "../../utils/format";

// Capitalise la 1ère lettre d'une chaîne
function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
function formatHeure(dateStr) {
  if (!dateStr) return "";
  return dateStr.slice(11, 16);
}

const PointJourModal = ({ open, onClose, caissier, defaultDate, token }) => {
  const [jour, setJour] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [point, setPoint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setPoint(null);
    const authToken = token || localStorage.getItem("token");
    api.get(`/api/stockFlux?date=${jour}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => setPoint(res.data.pointCaisse))
      .catch(err => {
        if (err?.response?.status === 401) setError("Non autorisé. Veuillez vous reconnecter.");
        else setError("Erreur de chargement du point caisse");
      })
      .finally(() => setLoading(false));
  }, [open, jour, token]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-3xl mx-4 bg-white rounded-lg shadow-xl py-8 my-8 flex flex-col print:w-[100vw] print:max-w-full max-h-[90vh] print:shadow-none print:rounded-none">
        {/* Entête toujours visible et imprimée */}
        <div className="px-6 pt-2 pb-2 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white print:bg-white print:border-b print:border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Journal de caisse du&nbsp;
            <input
              type="date"
              value={jour}
              onChange={e => setJour(e.target.value)}
              className="border px-2 py-1 rounded print:border-0 print:bg-transparent"
              style={{ minWidth: 140 }}
            />
          </h2>
          <div className="text-sm text-gray-700 font-semibold">{caissier ? `Caissier : ${caissier}` : "Caissier : —"}</div>
        </div>
        {/* Le contenu peut défiler à l'écran, jamais à l'impression */}
        <div className="flex-1 overflow-y-auto px-6 pb-0 modal-content print:overflow-visible">
          {loading ? (
            <div className="my-8 text-center text-gray-500">Chargement…</div>
          ) : error ? (
            <div className="my-8 text-center text-red-600">{error}</div>
          ) : !point ? (
            <div className="my-8 text-center text-gray-400">Aucune donnée pour ce jour.</div>
          ) : (
            <div className="p-3 md:p-6 bg-white rounded-lg shadow flex-1 print:shadow-none print:rounded-none">
              {/* ... sections et tableaux comme dans la version précédente ... */}
              {/* Achats & Dépenses */}
              <section className="mb-8 pb-4 border-t-2 border-red-50">
                <div className="font-bold text-green-900 bg-red-50 rounded-t px-2 py-1 mb-1 inline-block">Achats & Dépenses</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left py-1 px-2 bg-red-50">Heure</th>
                      <th className="text-left py-1 px-2 bg-red-50">Type</th>
                      <th className="text-left py-1 px-2 bg-red-50">Fournisseur/Destinataire</th>
                      <th className="text-left py-1 px-2 bg-red-50">Libellé</th>
                      <th className="text-left py-1 px-2 bg-red-50">Montant (F CFA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {point.achats.map(a => (
                      <tr key={"achat" + a.id}>
                        <td className="py-1 px-2">{formatHeure(a.created_at)}</td>
                        <td className="py-1 px-2">{capitalize(a.kind)}</td>
                        <td className="py-1 px-2">{capitalize(a.client_name)}</td>
                        <td className="py-1 px-2">{capitalize(a.designation_name)}</td>
                        <td className="py-1 px-2 text-right text-red-600 font-bold">-{formatInt(a.montant)}</td>
                      </tr>
                    ))}
                    {point.depenses.map(d => (
                      <tr key={"depense" + d.id}>
                        <td className="py-1 px-2">{formatHeure(d.created_at)}</td>
                        <td className="py-1 px-2">{capitalize(d.kind)}</td>
                        <td className="py-1 px-2">{capitalize(d.client_name)}</td>
                        <td className="py-1 px-2">{capitalize(d.designation_name)}</td>
                        <td className="py-1 px-2 text-right text-red-600 font-bold">-{formatInt(d.montant)}</td>
                      </tr>
                    ))}
                    <tr className="bg-red-50 font-bold">
                      <td colSpan={4} className="text-right py-1 px-2">Total Achats & Dépenses</td>
                      <td className="text-right text-red-600 py-1 px-2">-{formatInt(point.totalAchats + point.totalDepenses)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Encaissements du jour */}
              <section className="mb-8 pb-4 border-t-2 border-emerald-200">
                <div className="font-bold text-green-900 bg-emerald-100 rounded-t px-2 py-1 mb-1 inline-block">Encaissements du jour</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left py-1 px-2 bg-emerald-50">Heure</th>
                      <th className="text-left py-1 px-2 bg-emerald-50">Client</th>
                      <th className="text-left py-1 px-2 bg-emerald-50">Produit</th>
                      <th className="text-left py-1 px-2 bg-emerald-50">Vente du</th>
                      <th className="text-left py-1 px-2 bg-emerald-50">Montant (F CFA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {point.encaissementsDuJour.map(e => (
                      <tr key={"enc" + e.id}>
                        <td className="py-1 px-2">{formatHeure(e.created_at)}</td>
                        <td className="py-1 px-2">{capitalize(e.client_name)}</td>
                        <td className="py-1 px-2">{capitalize(e.designation_name)}</td>
                        <td className="py-1 px-2">{e.date}</td>
                        <td className="py-1 px-2 text-right text-green-700 font-bold">+{formatInt(e.montant)}</td>
                      </tr>
                    ))}
                    <tr className="bg-green-50 font-bold">
                      <td colSpan={4} className="text-right py-1 px-2">Total Encaissements du jour</td>
                      <td className="text-right text-green-700 py-1 px-2">+{formatInt(point.totalEncaissements)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Recouvrements */}
              <section className="mb-8 pb-4 border-t-2 border-sky-200">
                <div className="font-bold text-sky-900 bg-sky-100 rounded-t px-2 py-1 mb-1 inline-block">Recouvrements</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left py-1 px-2 bg-sky-50">Heure</th>
                      <th className="text-left py-1 px-2 bg-sky-50">Client</th>
                      <th className="text-left py-1 px-2 bg-sky-50">Produit</th>
                      <th className="text-left py-1 px-2 bg-sky-50">Vente du</th>
                      <th className="text-left py-1 px-2 bg-sky-50">Montant (F CFA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {point.recouvrements.map(r => (
                      <tr key={"recouv" + r.id}>
                        <td className="py-1 px-2">{formatHeure(r.created_at)}</td>
                        <td className="py-1 px-2">{capitalize(r.client_name)}</td>
                        <td className="py-1 px-2">{capitalize(r.designation_name)}</td>
                        <td className="py-1 px-2">{r.date}</td>
                        <td className="py-1 px-2 text-right text-sky-900 font-bold">+{formatInt(r.montant)}</td>
                      </tr>
                    ))}
                    <tr className="bg-sky-50 font-bold">
                      <td colSpan={4} className="text-right py-1 px-2">Total Recouvrements</td>
                      <td className="text-right text-sky-900 py-1 px-2">+{formatInt(point.totalRecouvrements)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Résumé caisse */}
              <section className="mt-8">
                <div className="font-bold text-lime-900 bg-lime-100 rounded-t px-2 py-1 mb-1 inline-block">Résumé caisse</div>
                <table className="w-full border-collapse mb-2">
                  <tbody>
                    <tr>
                      <td colSpan={3}></td>
                      <td className="text-right font-semibold py-1 px-2">Total entrées</td>
                      <td className="text-right py-1 px-2 text-green-700 font-bold">+{formatInt(point.totalEntrees)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3}></td>
                      <td className="text-right font-semibold py-1 px-2">Total sorties</td>
                      <td className="text-right py-1 px-2 text-red-600 font-bold">-{formatInt(point.totalSorties)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3}></td>
                      <td className="text-right font-semibold py-1 px-2">Solde de clôture</td>
                      <td className="text-right py-1 px-2 font-extrabold">{formatInt(point.soldeCloture)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          )}
          <div className="mt-6 text-sm text-gray-500 px-6 print:mt-2">Signature caissier : _____________________</div>
        </div>
        {/* Zone action toujours masquée à l'impression */}
  <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3 print:hidden bg-slate-50 rounded-b-lg shadow-inner sticky bottom-0">
          <button
            type="button"
            className="border bg-white px-4 py-2 rounded hover:bg-gray-50"
            onClick={onClose}
          >Fermer</button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >Imprimer</button>
          <button
            onClick={() => {
              const txt = document.querySelector(".modal-content")?.innerText || "";
              if (navigator.share) navigator.share({ text: txt });
              else { navigator.clipboard.writeText(txt); alert("Le point de caisse a été copié !"); }
            }}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >Partager</button>
        </div>
      </div>
      {/* CSS print pour enlever les ombres et arrondis si jamais des composants parents en rajoutent */}
      <style>{`
        @media print {
          .shadow, .shadow-xl, .shadow-inner, .print\\:shadow-none { box-shadow: none !important; }
          .rounded-lg, .rounded, .print\\:rounded-none { border-radius: 0 !important; }
        }
      `}</style>
    </div>
  );
};

export default PointJourModal;