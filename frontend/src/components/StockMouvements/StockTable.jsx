import React from "react";
import AddRow from "./AddRow";
import { capFrFirstLowerRest, formatInt, isoToFr } from "../../utils/format";

// Fonction utilitaire pour détecter si une valeur est numérique
const isNumeric = v => !isNaN(parseFloat(v)) && isFinite(v);

const StockTable = ({
  hasSelection,
  sameClientSelection,
  selectedRowIds,
  clientRowsCount,
  onSelectAll,
  addRowProps,
  rows,
  hasSearchActive,
  onToggleSelect,
  onOpenConfirm,
  onOpenEdit,
  onOpenProductHistory,
  onOpenPay,
  onOpenClientHistory,
}) => {
  const allSelectedChecked =
    hasSelection &&
    sameClientSelection &&
    selectedRowIds.size > 0 &&
    selectedRowIds.size === clientRowsCount &&
    clientRowsCount > 0;

  return (
    <div className="overflow-x-auto md:max-h-[640px] overflow-y-auto">
      <table className="min-w-full bg-white border border-gray-200 rounded-lg shadow-md">
        <thead className="bg-slate-50">
          <tr>
            <th className="py-3 px-2 border-b text-left font-medium w-8">
              <input
                type="checkbox"
                aria-label="Tout sélectionner"
                onChange={(e) => onSelectAll(e.target.checked)}
                checked={allSelectedChecked}
              />
            </th>
            <th className="py-3  px-2 border-b text-left font-medium w-14">#</th>
            <th className="py-3 px-4 border-b text-left font-medium">Date</th>
            <th className="py-3 px-4 border-b text-left font-medium">Type</th>
            <th className="py-3 px-4 border-b text-left font-medium">Désignation</th>
            <th className="py-3 px-4 border-b text-right font-medium">Stock</th>
            <th className="py-3 px-4 border-b text-right font-medium">Quantité</th>
            <th className="py-3 px-4 border-b text-right font-medium w-40">Prix </th>
            <th className="py-3 px-4 border-b text-right font-medium">Montant </th>
            <th className="py-3 px-4 border-b text-left font-medium">Client</th>
            <th className="py-3 px-4 border-b text-right font-medium">Stock Restant</th>
            <th className="py-3 px-4 border-b text-right font-medium">Balance</th>
            <th className="py-3 px-4 border-b text-right font-medium">Solde</th>
          </tr>
        </thead>
        <tbody>
          <AddRow {...addRowProps} />

          {rows.length === 0 ? (
            <tr>
              <td colSpan="13" className="py-8 text-center text-gray-500 italic">
                {hasSearchActive ? "Aucun résultat pour les filtres appliqués." : "Aucun mouvement/paiement."}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              // Seule une ligne "mouvement" est sélectionnable
              const isMovement = row.kind === "mouvement";
              const isSelectable = isMovement;
              const isSelected = isSelectable && selectedRowIds.has(row.id);

              const balanceVal = row.balance;
              const soldeVal = row.solde_cumule ?? row.solde;

              const balance = isNumeric(balanceVal)
                ? (parseFloat(balanceVal) > 0 ? "+" : "") + formatInt(balanceVal)
                : " ";
              const solde = isNumeric(soldeVal)
                ? formatInt(soldeVal)
                : " ";

              // Détermine la couleur de balance (vert, rouge, gris)
              const balanceColor =
                parseFloat(balanceVal) < 0
                  ? "text-red-600"
                  : parseFloat(balanceVal) > 0
                  ? "text-green-700"
                  : "text-gray-400";

              // Hover vert transparent personnalisé
              const rowHover =
                isSelected
                  ? "bg-yellow-50 ring-2 ring-yellow-300"
                  : "hover:bg-green-100/60";

              // Info source pour les paiements/achats (titre, type et client)
              let paiementSourceDescr = "";
              if (row.kind === "paiement" || row.kind === "achat") {
                paiementSourceDescr = `Source : ${row.date || "?"} | ${row.type ? capFrFirstLowerRest(row.type) : "?"} | ${capFrFirstLowerRest(row.client_name) || "?"}`;
              }

              return (
                <tr
                  key={`${row.kind}-${row.id}-${idx}`}
                  className={`transition ${rowHover}`}
                >
                  {/* Checkbox */}
                  <td className="py-3 px-2  border-b  text-center">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner la ligne ${idx + 1}`}
                      checked={isSelected}
                      disabled={!isSelectable}
                      onChange={() => onToggleSelect(row.id, row.kind)}
                    />
                  </td>
                  {/* # - coloration dynamique */}
                  <td
                    className={`py-3 px-2 border-b bg-gray-100 select-none text-center font-semibold ${balanceColor} cursor-pointer`}
                    title={isSelectable ? "Cliquer pour supprimer ce mouvement" : row.kind === "achat" ? "Achat" : "Paiement"}
                    onClick={() => isSelectable && onOpenConfirm && onOpenConfirm(row, idx)}
                  >
                    {idx + 1}
                  </td>
                  {/* Date + mini-heure d'enregistrement */}
                  <td
                    className="py-3 px-4 border-b cursor-pointer"
                    title={isSelectable ? "Sélectionner/Désélectionner la ligne" : row.kind === "achat" ? "Achat" : "Paiement"}
                    onClick={() => isSelectable && onToggleSelect(row.id, row.kind)}
                  >
                    <div className="leading-tight">
                      <div>{isoToFr(row.date)}</div>
                      {(() => {
                        const t = row.created_time || (row.created_at && typeof row.created_at === 'string' ? row.created_at.slice(11,16) : '');
                        return t ? (
                          <div className="text-[11px] text-slate-500 mt-0.5">{t}</div>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  {/* Type */}
                  <td
                    className={`py-3 bg-gray-100 px-4 border-b ${isSelectable ? "cursor-pointer" : ""}`}
                    title={
                      isSelectable
                        ? "Modifier"
                        : paiementSourceDescr || (row.kind === "achat" ? "Achat" : "Paiement")
                    }
                    onClick={() => isSelectable && onOpenEdit && onOpenEdit(row)}
                    role="button"
                  >
                    {row.kind === "achat"
                      ? "Achat"
                      : row.kind === "paiement"
                        ? "Paiement"
                        : capFrFirstLowerRest(row.type)}
                  </td>
                  {/* Désignation (lien en noir) */}
                  <td
                    className="py-3 px-4 border-b cursor-pointer text-black"
                    title="Voir l'historique de ce produit"
                    onClick={() => onOpenProductHistory && onOpenProductHistory(row)}
                    role="button"
                  >
                    {capFrFirstLowerRest(row.designation_name)}
                  </td>
                  {/* Stock */}
                  <td className="py-3 px-4 border-b bg-gray-100 text-right tabular-nums">
                    {isSelectable ? formatInt(row.stock) : " "}
                  </td>
                  {/* Quantité */}
                  <td className="py-3 px-4 border-b text-right tabular-nums">
                    {isSelectable ? formatInt(row.quantite) : " "}
                  </td>
                  {/* Prix agrandie */}
                  <td className="py-3 px-4 bg-gray-100 border-b text-right tabular-nums w-40">
                    {isSelectable ? formatInt(row.prix) : " "}
                  </td>
                  {/* Montant */}
                  <td
                    className={`py-3 px-4 border-b font-medium text-right  tabular-nums cursor-pointer`}
                    title={row.kind === "paiement" ? "Paiement" : row.kind === "achat" ? "Achat" : ""}
                    data-descr={paiementSourceDescr}
                    onMouseOver={e => {
                      if (paiementSourceDescr) {
                        e.currentTarget.setAttribute("data-descr", paiementSourceDescr);
                      }
                    }}
                    onClick={() => onOpenPay && onOpenPay(row)}
                    role="button"
                  >
                    {formatInt(row.montant)}
                  </td>
                  {/* Client (lien en noir) */}
                  <td
                    className="py-3 px-4 border-b bg-gray-100 cursor-pointer text-black"
                    title="Voir l'historique de ce client/fournisseur"
                    onClick={() => onOpenClientHistory && onOpenClientHistory(row)}
                    role="button"
                  >
                    {capFrFirstLowerRest(row.client_name)}
                  </td>
                  {/* Stock restant */}
                  <td className="py-3 px-4 border-b  font-semibold text-green-600 text-right tabular-nums">
                    {isSelectable ? formatInt(row.stockR) : " "}
                  </td>
                  {/* BALANCE - coloration dynamique */}
                  <td className={`py-3 px-4 border-b text-right bg-gray-100 tabular-nums font-semibold ${balanceColor}`}>
                    {balance}
                  </td>
                  {/* SOLDE */}
                  <td className="py-3 px-4 border-b  text-right tabular-nums font-bold text-gray-700">
                    {solde}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default StockTable;