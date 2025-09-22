export function normalizeType(val) {
  const s = String(val || "").trim().toLowerCase();
  if (!s) return "";
  const noDia = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (noDia.startsWith("entree") || noDia.startsWith("appro")) return "entree";
  if (noDia.startsWith("sortie") || noDia.startsWith("vente")) return "sortie";
  return noDia;
}

export function parseDateToTime(d) {
  if (!d) return 0;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + "T00:00:00Z");
    return isNaN(t) ? 0 : t;
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

// FIFO / WAC
export function computeHistoryValuation(historyLines, method /* "fifo" | "wac" */) {
  const typeRank = (k) => (k === "entree" ? 0 : 1);

  const asc = [...historyLines]
    .map((l, idx) => ({
      ...l,
      _idx: idx,
      _kind: normalizeType(l.type),
      _time: parseDateToTime(l.date),
    }))
    .sort((a, b) => (a._time - b._time) || (typeRank(a._kind) - typeRank(b._kind)) || (a._idx - b._idx));

  const nextEntryUnit = new Array(asc.length).fill(0);
  let next = 0;
  for (let i = asc.length - 1; i >= 0; i--) {
    const l = asc[i];
    if (l._kind === "entree") {
      const q = Number(l.quantite) || 0;
      const p = Number(l.prix) || 0;
      const m = Number(l.montant) || 0;
      const unit = p > 0 ? p : (q > 0 && m > 0 ? (m / q) : 0);
      if (unit > 0) next = unit;
    }
    nextEntryUnit[i] = next;
  }

  const layers = [];
  let stockQty = 0;
  let avgCost = 0;
  let lastKnownCost = 0;

  const computedAsc = asc.map((l, i) => {
    const kind = l._kind;
    const qty = Number(l.quantite) || 0;
    const prix = Number(l.prix) || 0;
    const m = Number(l.montant);
    const montant = isFinite(m) && m > 0 ? m : (qty * prix) || 0;

    let achat = 0;
    let marge = 0;
    let unitCostUsed = 0;

    if (kind === "entree") {
      const unit = prix > 0 ? prix : (qty > 0 && montant > 0 ? (montant / qty) : lastKnownCost);
      if (unit > 0) lastKnownCost = unit;

      if (method === "fifo") {
        if (qty > 0 && unit > 0) layers.push({ qty, unit });
      } else {
        const totalCostBefore = stockQty * avgCost;
        const entryCost = qty * (unit || 0);
        const newQty = stockQty + qty;
        if (newQty > 0) avgCost = (totalCostBefore + entryCost) / newQty;
        stockQty = newQty;
      }
    } else if (kind === "sortie") {
      if (method === "fifo") {
        let remaining = qty;
        let cost = 0;
        while (remaining > 0 && layers.length > 0) {
          const layer = layers[0];
          const used = Math.min(layer.qty, remaining);
          cost += used * layer.unit;
          layer.qty -= used;
          remaining -= used;
          if (layer.qty <= 0) layers.shift();
        }
        if (remaining > 0) {
          const fallback = layers[0]?.unit || lastKnownCost || nextEntryUnit[i] || 0;
          achat = cost + remaining * fallback;
        } else {
          achat = cost;
        }
        unitCostUsed = qty > 0 ? achat / qty : 0;
      } else {
        achat = qty * (avgCost || 0);
        unitCostUsed = avgCost || 0;
        stockQty = stockQty - qty;
      }
      marge = montant - achat;
    }

    return {
      ...l,
      _unitCostUsed: unitCostUsed,
      _montant: montant,
      _achat: achat,
      _marge: marge,
    };
  });

  const desc = computedAsc.sort((a, b) => (b._time - a._time) || (typeRank(a._kind) - typeRank(b._kind)));

  const totals = desc.reduce(
    (acc, l) => {
      acc.montant += Number(l._montant) || 0;
      acc.achat   += Number(l._achat)   || 0;
      acc.marge   += Number(l._marge)   || 0;
      return acc;
    },
    { montant: 0, achat: 0, marge: 0 }
  );

  return { lines: desc, totals };
}