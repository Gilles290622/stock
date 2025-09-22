// Dates
export function getTodayFr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Vérifie si une chaîne est une date valide au format dd/mm/yyyy.
 * Retourne true si la date existe réellement (ex: 31/02/2024 -> false).
 */
export function isValidDateFr(str) {
  if (!str || typeof str !== "string") return false;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim());
  if (!m) return false;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.getFullYear() === yyyy && dt.getMonth() === mm - 1 && dt.getDate() === dd;
}

/**
 * Convertit "dd/mm/yyyy" en "yyyy-mm-dd" (ISO) ou retourne null si invalide.
 */
export function frToIso(dateFr) {
  if (!dateFr) return null;
  const s = String(dateFr).trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  if (!isValidDateFr(s)) return null;
  const [, dd, mm, yyyy] = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convertit une chaîne ISO (yyyy-mm-dd ou yyyy-mm-ddTHH:MM:SS...) en dd/mm/yyyy.
 * Si la chaîne n'est pas ISO simple, renvoie la valeur telle quelle.
 */
export function isoToFr(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return String(iso);
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

// Texte/chiffres
export function capFrFirstLowerRest(val) {
  if (val == null) return "";
  const s = String(val).trim();
  if (!s) return "";
  if (s.toUpperCase() === "N/A") return "N/A";
  const lower = s.toLocaleLowerCase("fr-FR");
  return lower.charAt(0).toLocaleUpperCase("fr-FR") + lower.slice(1);
}

export function formatInt(n) {
  if (n === "" || n === null || isNaN(n)) return "";
  return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

export function norm(val) {
  return String(val ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

export function placeCaretAtEnd(el) {
  if (!el) return;
  el.focus();
  if (typeof window.getSelection !== "undefined" && typeof document.createRange !== "undefined") {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

const UNITS = ["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize"];

function below20to16Fr(n) {
  if (n < 17) return UNITS[n];
  if (n === 17) return "dix-sept";
  if (n === 18) return "dix-huit";
  if (n === 19) return "dix-neuf";
  return String(n);
}
function below100Fr(n) {
  if (n < 17) return UNITS[n];
  if (n < 20) return "dix-" + UNITS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  const tensWords = { 2:"vingt",3:"trente",4:"quarante",5:"cinquante",6:"soixante" };
  if (tens <= 6) {
    const t = tensWords[tens];
    if (unit === 0) return t;
    if (unit === 1) return t + " et un";
    return t + "-" + below20to16Fr(unit);
  }
  if (tens === 7) {
    if (unit === 1) return "soixante et onze";
    return "soixante-" + (unit === 0 ? "dix" : below20to16Fr(10 + unit));
  }
  if (tens === 8) {
    if (unit === 0) return "quatre-vingts";
    if (unit === 1) return "quatre-vingt-un";
    return "quatre-vingt-" + below20to16Fr(unit);
  }
  if (unit === 0) return "quatre-vingt-dix";
  return "quatre-vingt-" + below20to16Fr(10 + unit);
}
function below1000Fr(n) {
  if (n < 100) return below100Fr(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let head = hundreds === 1 ? "cent" : UNITS[hundreds] + " cent";
  if (hundreds > 1 && rest === 0) head += "s";
  if (rest === 0) return head;
  return head + " " + below100Fr(rest);
}
function numberToFrenchWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return "zéro";
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;
  const parts = [];
  if (milliards) parts.push((milliards === 1 ? "un" : below1000Fr(milliards)) + " milliard" + (milliards > 1 ? "s" : ""));
  if (millions) parts.push((millions === 1 ? "un" : below1000Fr(millions)) + " million" + (millions > 1 ? "s" : ""));
  if (milliers) parts.push((milliers === 1 ? "mille" : below1000Fr(milliers) + " mille"));
  if (reste) parts.push(below1000Fr(reste));
  return parts.join(" ");
}

export function amountToWordsFr(amount) {
  const words = numberToFrenchWords(amount);
  return `${words} francs CFA`;
}

export const formatFrSpace = (n) => {
  const x = Number(n);
  if (!isFinite(x)) return "0";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
    .format(x)
    .replace(/\u202F|\u00A0/g, " ");
};