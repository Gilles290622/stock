import React from "react";

const formatDateForInput = (s) => {
  if (!s) return "";
  // already in dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // iso yyyy-mm-dd or yyyy-mm-ddT...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  // try parsing other date strings
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return s;
};

const handleDateInputFormat = (raw) => {
  // keep digits only, limit to 8 (ddmmyyyy)
  let digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length >= 5) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
};

const EditMouvementModal = ({
  open,
  onClose,
  onSubmit,
  loading,
  error,
  form,
  setForm,
  designationOptions,
  clientOptions,
}) => {
  if (!open || !form) return null;

  const displayDate = formatDateForInput(form.date);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <form onSubmit={onSubmit}>
          <div className="px-6 pt-6">
            <h2 className="text-lg font-semibold text-gray-900">Modifier le mouvement</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Date (JJ/MM/AAAA)</label>
                <input
                  type="text"
                  value={displayDate}
                  onChange={(e) => {
                    const formatted = handleDateInputFormat(e.target.value);
                    setForm((p) => ({ ...p, date: formatted }));
                  }}
                  placeholder="jj/mm/aaaa"
                  className="w-full border rounded px-3 py-2"
                  inputMode="numeric"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="entree">Entree</option>
                  <option value="sortie">Sortie</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Désignation</label>
                <select
                  value={form.designation_id}
                  onChange={(e) => {
                    const val = e.target.value;
                    const id = val ? parseInt(val, 10) : "";
                    const name = id ? (designationOptions.find((o) => o.id === id)?.name || "") : "";
                    setForm((p) => ({ ...p, designation_id: id, designation_name: name }));
                  }}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Sélectionnez une désignation</option>
                  {designationOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Client</label>
                <select
                  value={form.client_id}
                  onChange={(e) => {
                    const val = e.target.value;
                    const id = val ? parseInt(val, 10) : "";
                    const name = id ? (clientOptions.find((o) => o.id === id)?.name || "") : "";
                    setForm((p) => ({ ...p, client_id: id, client_name: name }));
                  }}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Sélectionnez un client</option>
                  {clientOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Quantité</label>
                <input
                  type="text"
                  value={String(form.quantite)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((p) => ({ ...p, quantite: v }));
                  }}
                  className="w-full border rounded px-3 py-2 text-right"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Prix (F CFA)</label>
                <input
                  type="text"
                  value={String(form.prix)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((p) => ({ ...p, prix: v }));
                  }}
                  className="w-full border rounded px-3 py-2 text-right"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
          </div>

          <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3">
            <button type="button" className="border bg-white px-4 py-2 rounded hover:bg-gray-50" onClick={onClose} disabled={loading}>
              Annuler
            </button>
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50" disabled={loading}>
              {loading ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditMouvementModal;