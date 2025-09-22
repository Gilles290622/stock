import { useEffect, useRef, useState } from 'react';
import { createDepense } from '../../api/stockDepenses';

export default function DepenseModal({ open, onClose, onCreated }) {
  const [date, setDate] = useState('');
  const [libelle, setLibelle] = useState('');
  const [destinataire, setDestinataire] = useState('');
  const [montant, setMontant] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (open) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      setDate(`${yyyy}-${mm}-${dd}`);
      setLibelle('');
      setDestinataire('');
      setMontant('');
      setErr('');
      setTimeout(() => firstFieldRef.current?.focus(), 0);

      const onKey = (e) => e.key === 'Escape' && onClose();
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const dep = await createDepense({
        date,
        libelle,
        montant: Number(montant),
        destinataire,
      });
      onCreated?.(dep);
      onClose();
    } catch (error) {
      setErr(error.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="m-0 text-lg font-semibold text-slate-800">Enregistrer une dépense</h3>
          <button
            onClick={onClose}
            type="button"
            aria-label="Fermer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              ref={firstFieldRef}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Libellé</label>
            <input
              type="text"
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Ex: Carburant, Fournitures..."
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Destinataire (optionnel)</label>
            <input
              type="text"
              value={destinataire}
              onChange={(e) => setDestinataire(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Payé à..."
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Montant</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-right text-slate-800 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="0.00"
            />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <div className="mt-2 flex justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
            >
              {loading && (
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
              )}
              {loading ? 'Enregistrement...' : 'Valider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}