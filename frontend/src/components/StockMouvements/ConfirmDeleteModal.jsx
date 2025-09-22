import React from "react";
import { capFrFirstLowerRest, formatInt } from "../../utils/format";

const ConfirmDeleteModal = ({ open, onClose, onConfirm, loading, error, target, index }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold text-gray-900">Confirmer la suppression</h2>
          <p className="mt-2 text-sm text-gray-600">
            Voulez-vous vraiment supprimer cette ligne{typeof index === "number" ? ` #${index + 1}` : ""} ?
          </p>
          {target && (
            <div className="mt-3 rounded bg-gray-50 p-3 text-sm text-gray-700">
              <div><span className="font-medium">Date:</span> {target.date}</div>
              <div><span className="font-medium">Désignation:</span> {capFrFirstLowerRest(target.designation_name)}</div>
              <div><span className="font-medium">Type:</span> {capFrFirstLowerRest(target.type)}</div>
              <div><span className="font-medium">Quantité:</span> {formatInt(target.quantite)}</div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3">
          <button type="button" className="border bg-white px-4 py-2 rounded hover:bg-gray-50" onClick={onClose} disabled={loading}>
            Annuler
          </button>
          <button type="button" className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50" onClick={onConfirm} disabled={loading}>
            {loading ? "Suppression..." : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;