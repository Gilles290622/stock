import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import DepenseModal from './StockMouvements/DepenseModal';
import PointJourModal from "./StockMouvements/PointJourModal";
import ModalHistoriqueRecherche from "./StockMouvements/ModalHistoriqueRecherche";
import ClientReleveModal from "./StockMouvements/ClientReleveModal";
import {
  capFrFirstLowerRest,
  formatInt,
  frToIso,
  getTodayFr,
  isoToFr,
  norm,
  placeCaretAtEnd,
  amountToWordsFr,
} from "../utils/format";
import { normalizeType } from "../utils/valuation";
import ConfirmDeleteModal from "./StockMouvements/ConfirmDeleteModal";
import EditMouvementModal from "./StockMouvements/EditMouvementModal";
import ProductHistoryModal from "./StockMouvements/ProductHistoryModal";
import ClientsListModal from "./StockMouvements/ClientsListModal";
import ProductsListModal from "./StockMouvements/ProductsListModal";
import ClientHistoryModal from "./StockMouvements/ClientHistoryModal";
import PaymentModal from "./StockMouvements/PaymentModal";
import StockTable from "./StockMouvements/StockTable";
import InvoiceModal from "./StockMouvements/InvoiceModal";
import {
  DocumentDuplicateIcon,     // Facture
  BanknotesIcon,             // Journal caisse
  UserCircleIcon,            // Relevé client
  Cog6ToothIcon,             // Réglage clientèle
  CurrencyEuroIcon,          // Dépense
  ClockIcon                  // Historique
} from "@heroicons/react/24/outline";

// Utilitaire pour reconnaitre la date JJ/MM/AAAA
function isValidDateFr(str) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(str);
}

const DEBOUNCE_MS = 200;

const ENV = typeof import.meta !== "undefined" ? import.meta.env : {};
const COMPANY = {
  name: ENV?.VITE_COMPANY_NAME || "Votre entreprise",
  address: ENV?.VITE_COMPANY_ADDRESS || "",
  phone: ENV?.VITE_COMPANY_PHONE || "",
  email: ENV?.VITE_COMPANY_EMAIL || "",
};

const StockMouvements = ({ user }) => {
  const navigate = useNavigate();

  // États principaux
  
  const [depenseOpen, setDepenseOpen] = useState(false);

  // Recherche

  const [openHistorique, setOpenHistorique] = useState(false);

  // Add-line form + suggestions
  const [formData, setFormData] = useState({
    date: getTodayFr(),
    type: "entree",
    designation_name: "",
    designation_id: null,
    stock: "",
    quantite: "",
    prix: "",
    montant: "",
    client_name: "",
    client_id: null,
    stockR: "",
  });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const [designationSuggestions, setDesignationSuggestions] = useState([]);
  const [clientSuggestions, setClientSuggestions] = useState([]);

  // Refs pour suggestions et caret
  const rowRef = useRef(null);
  const dateRef = useRef(null);
  const typeRef = useRef(null);
  const designationRef = useRef(null);
  const quantiteRef = useRef(null);
  const prixRef = useRef(null);
  const clientRef = useRef(null);

  const desAbortRef = useRef(null);
  const desTimerRef = useRef(null);
  const desSeqRef = useRef(0);

  const cliAbortRef = useRef(null);
  const cliTimerRef = useRef(null);
  const cliSeqRef = useRef(0);

  const submittingRef = useRef(false);

  // Sélection pour facturation
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const hasSelection = selectedRowIds.size > 0;
  const [selectionError, setSelectionError] = useState("");

  // Delete modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteIndex, setDeleteIndex] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // History modals
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDesignation, setHistoryDesignation] = useState({ id: null, name: "" });

  const [clientHistoryOpen, setClientHistoryOpen] = useState(false);
  const [clientHistoryEntity, setClientHistoryEntity] = useState({ id: null, name: "" });
  const [clientHistoryMode, setClientHistoryMode] = useState("sortie");

  // Payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payContext, setPayContext] = useState(null);

  // Point caisse modal
  const [pointJourOpen, setPointJourOpen] = useState(false);
  const [pointJour, setPointJour] = useState(null);
  const [pointJourLoading, setPointJourLoading] = useState(false);
  const [pointJourError, setPointJourError] = useState("");
  const jourCaisse = new Date().toISOString().slice(0,10);

  // Invoice modal
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [clientInfo, setClientInfo] = useState({ name: "", address: "", phone: "", email: "" });
  const [invoiceNumber, setInvoiceNumber] = useState("");

  const token = useMemo(() => localStorage.getItem("token"), []);
  const currentUserId = useMemo(() => {
    try {
      const t = localStorage.getItem('token');
      if (!t) return null;
      const payload = JSON.parse(atob(t.split('.')[1]));
      return payload?.id || null;
    } catch { return null; }
  }, []);
  const isUser7 = currentUserId === 7;

  // Compteurs globaux (depuis la base)
  const [clientsTotal, setClientsTotal] = useState(null);
  const [productsTotal, setProductsTotal] = useState(null);

  const fetchCounts = async () => {
    try {
      const t = localStorage.getItem('token');
      const headers = t ? { Authorization: `Bearer ${t}` } : undefined;
      const [cCnt, pCnt] = await Promise.all([
        api.get('/api/clients/count', { headers }),
        api.get('/api/designations/count', { headers })
      ]);
      setClientsTotal(Number(cCnt?.data?.count ?? 0));
      setProductsTotal(Number(pCnt?.data?.count ?? 0));
    } catch (_) {
      // En cas d'erreur, laisser null pour ne rien afficher
      setClientsTotal(null);
      setProductsTotal(null);
    }
  };
  // New modals for listing clients and products
  const [clientsListOpen, setClientsListOpen] = useState(false);
  const [productsListOpen, setProductsListOpen] = useState(false);
  const hasOpenPopups = () => designationSuggestions.length > 0 || clientSuggestions.length > 0;
 const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchDebounceRef = useRef();
  const [searchQuery, setSearchQuery] = useState("");
  
const [feed, setFeed] = useState([]);

const [releveOpen, setReleveOpen] = useState(false);
const [releveClient, setReleveClient] = useState(null);



// Charge les mouvements du jour
const fetchMouvementsDuJour = async () => {
  setLoading(true);
  try {
    const today = new Date().toISOString().slice(0, 10); // format YYYY-MM-DD
    const url = `/api/stockFlux?date=${today}`;
    const t = localStorage.getItem("token");
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

// Recherche générique (texte ou date JJ/MM/AAAA) — fallback au jour courant si vide
const fetchFeed = async (value) => {
  const q = String(value ?? "").trim();
  if (!q) return fetchMouvementsDuJour();
  setLoading(true);
  try {
    const t = localStorage.getItem("token");
    const params = new URLSearchParams();
    params.append("searchQuery", q);
    const url = `/api/stockFlux/search?${params.toString()}`;
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



  useEffect(() => {
    fetchMouvementsDuJour();
    // S'assurer que le token est présent avant d'appeler les counts (évite des erreurs 401 en prod)
    setTimeout(() => fetchCounts(), 0);
  }, []);

  // Dériver la liste des mouvements (utile pour options, modales, etc.)
  const mouvements = useMemo(() => feed.filter((f) => f.kind === "mouvement"), [feed]);

  // Options selects
  const designationOptions = useMemo(() => {
    const map = new Map();
    mouvements.forEach((m) => {
      if (m.designation_id && m.designation_name && m.designation_name !== "N/A") map.set(m.designation_id, m.designation_name);
    });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  }, [mouvements]);

  const clientOptions = useMemo(() => {
    const map = new Map();
    mouvements.forEach((m) => {
      if (m.client_id && m.client_name && m.client_name !== "N/A") map.set(m.client_id, m.client_name);
    });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  }, [mouvements]);

  // Filtre local du flux
  const filteredFeed = feed;

  // Validation ligne d'ajout
  const canSubmit = () => {
    const isoDate = frToIso(formData.date);
    if (!isoDate) return false;
    const hasDesignation = (formData.designation_name && formData.designation_name.trim() !== "") || formData.designation_id != null;
    if (!hasDesignation) return false;
    const hasClient = (formData.client_name && formData.client_name.trim() !== "") || formData.client_id != null;
    if (!hasClient) return false;
    const q = parseInt(formData.quantite) || 0;
    const p = parseInt(formData.prix);
    if (q <= 0) return false;
    if (isNaN(p) || p < 0) return false;
    return true;
  };

  // Suggestions désignation / client (inchangé)
  const handleDesignationInput = (e) => {
    const value = e.currentTarget.innerText.trim();
    setFormData((prev) => ({ ...prev, designation_name: value, designation_id: null, stock: "" }));
    if (desTimerRef.current) clearTimeout(desTimerRef.current);
    if (!value) return setDesignationSuggestions([]);
    desTimerRef.current = setTimeout(async () => {
      if (desAbortRef.current) desAbortRef.current.abort();
      const controller = new AbortController();
      desAbortRef.current = controller;
      const seq = ++desSeqRef.current;
      try {
        const t = localStorage.getItem("token");
        const res = await api.get(`/api/designations/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${t}` }, signal: controller.signal
        });
        if (seq === desSeqRef.current) setDesignationSuggestions(res.data);
      } catch (err) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setDesignationSuggestions([]);
      }
    }, DEBOUNCE_MS);
  };

  const selectDesignation = async (e, name, id) => {
    e.preventDefault(); e.stopPropagation();
    if (designationRef.current) { designationRef.current.innerText = name; setTimeout(() => placeCaretAtEnd(designationRef.current), 0); }
    setFormData((prev) => ({ ...prev, designation_name: name, designation_id: id }));
    setDesignationSuggestions([]);
    try {
      const t = localStorage.getItem("token");
      const stockRes = await api.get(`/api/designations/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      const stockValue = stockRes.data.current_stock || 0;
      setFormData((prev) => {
        const q = parseInt(prev.quantite) || 0;
        const nextStockR = prev.type === "entree" ? stockValue + q : stockValue - q;
        return { ...prev, stock: stockValue, stockR: nextStockR };
      });
    } catch { }
    if (quantiteRef.current) { quantiteRef.current.focus(); placeCaretAtEnd(quantiteRef.current); }
  };

  const handleClientInput = (e) => {
    const value = e.currentTarget.innerText.trim();
    setFormData((prev) => ({ ...prev, client_name: value, client_id: null }));
    if (cliTimerRef.current) clearTimeout(cliTimerRef.current);
    if (!value) return setClientSuggestions([]);
    cliTimerRef.current = setTimeout(async () => {
      if (cliAbortRef.current) cliAbortRef.current.abort();
      const controller = new AbortController();
      cliAbortRef.current = controller;
      const seq = ++cliSeqRef.current;
      try {
        const t = localStorage.getItem("token");
        const res = await api.get(`/api/clients/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${t}` }, signal: controller.signal
        });
        if (seq === cliSeqRef.current) setClientSuggestions(res.data);
      } catch (err) {
        if (err.name === "CanceledError" || err.name === "AbortError") return;
        setClientSuggestions([]);
      }
    }, DEBOUNCE_MS);
  };
  const selectClient = (e, name, id) => {
    e.preventDefault(); e.stopPropagation();
    if (clientRef.current) { clientRef.current.innerText = name; setTimeout(() => placeCaretAtEnd(clientRef.current), 0); }
    setFormData((prev) => ({ ...prev, client_name: name, client_id: id }));
    setClientSuggestions([]);
  };

  // Boutons pour afficher les listes complètes
  const openClientsList = () => setClientsListOpen(true);
  const openProductsList = () => setProductsListOpen(true);

  const handleCellKeyDown = (nextRef) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (!hasOpenPopups() && canSubmit()) handleSubmit(e);
      else if (nextRef?.current) { nextRef.current.focus(); placeCaretAtEnd(nextRef.current); }
    }
    if (e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      if (nextRef?.current) { nextRef.current.focus(); placeCaretAtEnd(nextRef.current); }
    }
  };
  const handleNumericKeyDown = (nextRef) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (!hasOpenPopups() && canSubmit()) handleSubmit(e);
      else if (nextRef?.current) { nextRef.current.focus(); placeCaretAtEnd(nextRef.current); }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      if (nextRef?.current) { nextRef.current.focus(); placeCaretAtEnd(nextRef.current); }
      return;
    }
    placeCaretAtEnd(e.currentTarget);
  };
  const handleIntInput = (field) => (e) => {
    let raw = e.currentTarget.innerText.replace(/\D/g, "");
    if (raw.length > 1 && raw.startsWith("0")) raw = raw.replace(/^0+/, "");
    const n = raw === "" ? "" : parseInt(raw, 10);
    if (e.currentTarget.innerText !== (raw || "")) e.currentTarget.innerText = raw || "";
    setFormData((prev) => {
      let updated = { ...prev, [field]: n };
      if (field === "quantite" || field === "prix") {
        const prix = field === "prix" ? n : prev.prix;
        const quantite = field === "quantite" ? n : prev.quantite;
        updated.montant = (parseInt(prix || 0, 10) || 0) * (parseInt(quantite || 0, 10) || 0);
      }
      if (field === "quantite" || field === "stock") {
        const stock = field === "stock" ? n : prev.stock;
        const quantite = field === "quantite" ? n : prev.quantite;
        const s = parseInt(stock || 0, 10) || 0;
        const q = parseInt(quantite || 0, 10) || 0;
        updated.stockR = prev.type === "entree" ? s + q : s - q;
      }
      return updated;
    });
    setTimeout(() => placeCaretAtEnd(e.currentTarget), 0);
  };
  const handleDateInput = (e) => {
    let value = e.currentTarget.innerText.replace(/[^0-9/]/g, "");
    if (/^\d{2}$/.test(value)) value += "/";
    if (/^\d{2}\/\d{2}$/.test(value)) value += "/";
    value = value.slice(0, 10);
    setFormData((prev) => ({ ...prev, date: value }));
    setTimeout(() => {
      if (e.currentTarget.innerText !== value) e.currentTarget.innerText = value;
      placeCaretAtEnd(e.currentTarget);
    }, 0);
  };
  const handleTypeInput = (e) => {
    const raw = e.currentTarget.innerText.trim().toLowerCase();
    const nextType = raw.startsWith("s") ? "sortie" : "entree";
    if (e.currentTarget.innerText !== nextType) e.currentTarget.innerText = nextType;
    setFormData((prev) => {
      const s = parseInt(prev.stock || 0, 10) || 0;
      const q = parseInt(prev.quantite || 0, 10) || 0;
      return { ...prev, type: nextType, stockR: nextType === "entree" ? s + q : s - q };
    });
    setTimeout(() => placeCaretAtEnd(typeRef.current), 0);
  };
  const handleClientKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (!hasOpenPopups() && canSubmit()) handleSubmit(e);
    }
  };

const handleSubmit = async (e) => {
  e.preventDefault();
  if (formLoading || submittingRef.current) return;
  submittingRef.current = true;
  setFormLoading(true);
  setFormError("");

  const isoDate = frToIso(formData.date);
  if (!isoDate) { setFormError("Date invalide. Utilisez JJ/MM/AAAA."); setFormLoading(false); submittingRef.current = false; return; }
  const hasClient = (formData.client_name && formData.client_name.trim() !== "") || formData.client_id != null;
  if (!hasClient) { setFormError("Client obligatoire."); setFormLoading(false); submittingRef.current = false; return; }

  // Tentative de résolution des IDs côté client si non fournis mais nom saisi
  let resolvedDesignationId = formData.designation_id ?? null;
  let resolvedClientId = formData.client_id ?? null;
  const desName = (formData.designation_name || "").trim();
  const cliName = (formData.client_name || "").trim();

  try {
    const t = localStorage.getItem("token");
    if (!resolvedDesignationId && desName) {
      const resDes = await api.get(`/api/designations/search?q=${encodeURIComponent(desName)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const list = Array.isArray(resDes.data) ? resDes.data : [];
      const exact = list.find(d => String(d.name || "").toLowerCase() === desName.toLowerCase());
      if (exact) resolvedDesignationId = exact.id;
    }
    if (!resolvedClientId && cliName) {
      const resCli = await api.get(`/api/clients/search?q=${encodeURIComponent(cliName)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const list = Array.isArray(resCli.data) ? resCli.data : [];
      const exact = list.find(c => String(c.name || "").toLowerCase() === cliName.toLowerCase());
      if (exact) resolvedClientId = exact.id;
    }
    // Si toujours pas résolus, créer côté serveur pour obtenir les IDs
    if (!resolvedDesignationId && desName) {
      const createdDes = await api.post(
        '/api/designations',
        { name: desName },
        { headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } }
      );
      if (createdDes?.data?.id) resolvedDesignationId = createdDes.data.id;
    }
    if (!resolvedClientId && cliName) {
      const createdCli = await api.post(
        '/api/clients',
        { name: cliName },
        { headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } }
      );
      if (createdCli?.data?.id) resolvedClientId = createdCli.data.id;
    }
  } catch (_) {
    // En cas d'échec réseau, on laisse le backend gérer le find-or-create
  }

  const payload = {
    date: isoDate,
    type: formData.type,
    designation_id: resolvedDesignationId,
    designation_name: desName || undefined,
    quantite: parseInt(formData.quantite) || 0,
    prix: parseInt(formData.prix) || 0,
    client_id: resolvedClientId,
    client_name: cliName || undefined,
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const hasDesignation = payload.designation_id != null || (payload.designation_name && payload.designation_name !== "");
  if (!hasDesignation) { setFormError("Saisissez une désignation (ou sélectionnez-en une)."); setFormLoading(false); submittingRef.current = false; return; }
  if ((payload.quantite || 0) <= 0) { setFormError("Quantité invalide."); setFormLoading(false); submittingRef.current = false; return; }
  if ((payload.prix || 0) < 0) { setFormError("Prix invalide."); setFormLoading(false); submittingRef.current = false; return; }

  try {
    const t = localStorage.getItem("token");
    await api.post("/api/stockMouvements", payload, {
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    });
    if (designationRef.current) designationRef.current.innerText = "";
    if (clientRef.current) clientRef.current.innerText = "";
    if (quantiteRef.current) quantiteRef.current.innerText = "";
    if (prixRef.current) prixRef.current.innerText = "";
    setFormData({
      date: getTodayFr(), type: "entree", designation_name: "", designation_id: null, stock: "", quantite: "", prix: "", montant: "", client_name: "", client_id: null, stockR: ""
    });
    setDesignationSuggestions([]); setClientSuggestions([]);
    await fetchMouvementsDuJour(); // <-- Rafraîchis bien la liste !
    if (dateRef.current) { dateRef.current.focus(); placeCaretAtEnd(dateRef.current); }
  } catch (err) {
    const backendErr = err?.response?.data;
    const msg = backendErr?.error || backendErr?.message || backendErr?.details || "Erreur lors de l'ajout";
    setFormError(msg);
    if (err?.response?.status === 401 || err?.response?.status === 403) { localStorage.removeItem("token"); navigate("/login"); }
  } finally {
    setFormLoading(false); submittingRef.current = false;
  }
};

  // Suppression mouvement
  const openConfirm = (m, idx) => { setDeleteTarget(m); setDeleteIndex(idx); setDeleteError(""); setConfirmOpen(true); };
  const closeConfirm = () => { if (deleteLoading) return; setConfirmOpen(false); setDeleteTarget(null); setDeleteIndex(null); setDeleteError(""); };
  // remplace la fonction confirmDelete existante par celle-ci
// Remplace/complète ta fonction confirmDelete pour plus de logs
const confirmDelete = async () => {
  if (!deleteTarget) {
    console.warn("confirmDelete: pas de deleteTarget");
    return;
  }
  console.log("confirmDelete: deleting", deleteTarget);

  setDeleteLoading(true);
  setDeleteError("");

  try {
    const t = localStorage.getItem("token");
    if (!t) console.warn("confirmDelete: no token in localStorage");

    const res = await api.delete(`/api/stockMouvements/${deleteTarget.id}`, {
      headers: { Authorization: `Bearer ${t}` },
    });

    console.log("DELETE response data:", res?.data);
    closeConfirm();
    // refetch canonical state
    if (typeof fetchFeed === "function") await fetchFeed(searchQuery);
    else if (typeof fetchMouvementsDuJour === "function") await fetchMouvementsDuJour();
  } catch (err) {
    console.error("DELETE error:", err);
    console.error("err.response:", err?.response);
    console.error("err.response.status:", err?.response?.status);
    console.error("err.response.data:", err?.response?.data);
    const msg = err?.response?.data?.error || "Suppression impossible.";
    setDeleteError(msg);
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      localStorage.removeItem("token");
      navigate("/login");
    }
  } finally {
    setDeleteLoading(false);
  }
};
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && confirmOpen) { e.preventDefault(); closeConfirm(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  // Edition mouvement
  const openEdit = (row) => {
    if (row.kind === "paiement") return; // édition paiements via modale Paiement
    setEditForm({
      id: row.id,
      date: row.date || "",
      type: String(row.type || "").toLowerCase().startsWith("s") ? "sortie" : "entree",
      designation_id: row.designation_id || "",
      designation_name: row.designation_name === "N/A" ? "" : (row.designation_name || ""),
      quantite: row.quantite ?? "",
      prix: row.prix ?? "",
      client_id: row.client_id || "",
      client_name: row.client_name === "N/A" ? "" : (row.client_name || "")
    });
    setEditError(""); setEditOpen(true);
  };
  const closeEdit = () => { if (editLoading) return; setEditOpen(false); setEditForm(null); setEditError(""); };
 // À placer dans ton composant StockMouvements (remplace la fonction saveEdit existante)



const saveEdit = async (e) => {
  e?.preventDefault();
  if (!editForm || editLoading) return;

  // ---------- Validation / conversion date ----------
  const dateRaw = String(editForm.date || "").trim();
  let iso = null;
  if (isValidDateFr(dateRaw)) {
    iso = frToIso(dateRaw);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) {
    iso = dateRaw.slice(0, 10);
  } else {
    const parsed = Date.parse(dateRaw);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  if (!iso) {
    console.log("saveEdit - date invalide:", editForm.date);
    return setEditError("Date invalide. Utilisez JJ/MM/AAAA.");
  }

  // ---------- autres validations ----------
  if (!editForm.designation_id) return setEditError("Désignation obligatoire.");

  const qStr = String(editForm.quantite ?? "").trim();
  if (qStr === "" || isNaN(parseInt(qStr, 10)) || parseInt(qStr, 10) <= 0)
    return setEditError("Quantité invalide (> 0).");
  const quantite = parseInt(qStr, 10);

  const pStr = String(editForm.prix ?? "").trim();
  if (pStr === "" || isNaN(parseInt(pStr, 10)) || parseInt(pStr, 10) < 0)
    return setEditError("Prix invalide (>= 0).");
  const prix = parseInt(pStr, 10);

  if (!editForm.client_id) return setEditError("Client obligatoire.");

  const payload = {
    date: iso,
    type: editForm.type === "sortie" ? "sortie" : "entree",
    designation_id: editForm.designation_id,
    quantite,
    prix,
    client_id: editForm.client_id,
    // montant: quantite * prix, // ajoute si ton API attend ce champ
  };
  console.log('saveEdit payload envoyé:', payload);

  try {
    setEditLoading(true);
    const t = localStorage.getItem("token");
    await api.patch(`/api/stockMouvements/${editForm.id}`, payload, {
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    });

    // Fermer la modale d'édition immédiatement (évite chevauchement)
    closeEdit();

    // Rafraîchir l'affichage depuis le serveur pour obtenir l'état canonique
    if (typeof fetchFeed === "function") {
      await fetchFeed(searchQuery);
    } else if (typeof fetchMouvementsDuJour === "function") {
      await fetchMouvementsDuJour();
    }
  } catch (err) {
    const msg = err?.response?.data?.error || "Mise à jour impossible.";
    setEditError(msg);
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      localStorage.removeItem("token");
      navigate("/login");
    }
  } finally {
    setEditLoading(false);
  }
};

  // Sélection pour facturation — uniquement sur mouvements
  const selectedClientId = useMemo(() => {
    if (selectedRowIds.size === 0) return null;
    const firstSelectedId = Array.from(selectedRowIds)[0];
    const firstRow = mouvements.find((m) => m.id === firstSelectedId);
    return firstRow ? firstRow.client_id : null;
  }, [selectedRowIds, mouvements]);
  const sameClientSelection = useMemo(() => {
    if (selectedRowIds.size <= 1) return selectedRowIds.size === 1 ? true : false;
    let clientId = null;
    for (const m of mouvements) {
      if (selectedRowIds.has(m.id)) {
        if (clientId == null) clientId = m.client_id;
        else if (m.client_id !== clientId) return false;
      }
    }
    return true;
  }, [selectedRowIds, mouvements]);
  const clientRowsCount = useMemo(() => {
    if (selectedClientId == null) return 0;
    return mouvements.filter((m) => m.client_id === selectedClientId).length;
  }, [selectedClientId, mouvements]);

  const toggleSelect = (id, kind) => {
    if (kind === "paiement") return; // pas de sélection pour paiements
    setSelectedRowIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) { s.delete(id); setSelectionError(""); return s; }
      const row = mouvements.find((m) => m.id === id);
      if (!row) return s;
      if (s.size === 0) { s.add(id); setSelectionError(""); return s; }
      let existingClientId = null;
      for (const m of mouvements) { if (s.has(m.id)) { existingClientId = m.client_id; break; } }
      if (existingClientId != null && row.client_id !== existingClientId) {
        setSelectionError("Sélection multiple: choisissez des lignes du même client uniquement.");
        return s;
      }
      s.add(id); setSelectionError(""); return s;
    });
  };

  const selectAll = (checked) => {
    if (!checked) { setSelectedRowIds(new Set()); setSelectionError(""); return; }
    if (!selectedClientId) {
      setSelectionError("Sélectionner d'abord une ligne (client), puis utilisez 'Tout sélectionner' pour ce client.");
      return;
    }
    const newSet = new Set(mouvements.filter((m) => m.client_id === selectedClientId).map((m) => m.id));
    setSelectedRowIds(newSet); setSelectionError("");
  };

  // Facturation
  const selectedLines = useMemo(() => mouvements.filter((m) => selectedRowIds.has(m.id)), [selectedRowIds, mouvements]);
  const generateInvoiceNumber = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const cli = selectedClientId || "0000";
    return `INV-${y}${m}${day}-${cli}`;
  };
  const selectedTotal = useMemo(() => selectedLines.reduce((sum, l) => sum + (Number(l.montant) || 0), 0), [selectedLines]);
  const amountInWords = useMemo(() => amountToWordsFr(selectedTotal), [selectedTotal]);

  const openInvoice = async () => {
    if (!hasSelection || !sameClientSelection) {
      setSelectionError("Facturation: sélectionnez une ou plusieurs lignes du même client.");
      return;
    }
    setInvoiceLoading(true);
    setSelectionError("");
    try {
      let info = {
        name: selectedLines[0]?.client_name || "",
        address: "",
        phone: "",
        email: ""
      };
      if (selectedClientId) {
        try {
          const t = localStorage.getItem("token");
          const res = await api.get(`/api/clients/${selectedClientId}`, { headers: { Authorization: `Bearer ${t}` } });
          const d = res.data || {};
          info = { name: d.name || info.name, address: d.address || "", phone: d.phone || "", email: d.email || "" };
        } catch { }
      }
      setClientInfo(info);
      setInvoiceNumber(generateInvoiceNumber());
      setInvoiceOpen(true);
    } finally {
      setInvoiceLoading(false);
    }
  };

  // Point caisse
  const fetchPointJour = async () => {
    setPointJourLoading(true);
    setPointJourError("");
    try {
      const t = localStorage.getItem("token");
      const params = new URLSearchParams();
      params.append('date', jourCaisse);
      const url = `/api/stockFlux?${params.toString()}`;
      const res = await api.get(url, { headers: { Authorization: `Bearer ${t}` } });
      setPointJour(res.data.pointCaisse);
      setPointJourOpen(true);
    } catch (e) {
      setPointJourError("Impossible de charger le point de caisse.");
    } finally {
      setPointJourLoading(false);
    }
  };

  // UI
  if (loading) return <div className="text-center py-8 text-gray-600">Chargement des mouvements...</div>;
  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => fetchFeed(searchQuery)} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Réessayer</button>
      </div>
    );
  }

  const hasSearchActive = Boolean(searchQuery);

  const addRowProps = {
    rowRef, dateRef, typeRef, designationRef, quantiteRef, prixRef, clientRef, formData,
    onDateInput: handleDateInput, onTypeInput: handleTypeInput, handleCellKeyDown,
    handleDesignationInput, selectDesignation, clearDesignationSuggestions: () => setDesignationSuggestions([]),
    handleNumericKeyDown, handleIntInput, handleClientInput, selectClient, clearClientSuggestions: () => setClientSuggestions([]),
    handleClientKeyDown, designationSuggestions, clientSuggestions,
  };

  return (
    <div className="space-y-6">
     

      {/* Tableau principal: flux unifié */}
      <StockTable
        hasSelection={hasSelection}
        sameClientSelection={sameClientSelection}
        selectedRowIds={selectedRowIds}
        clientRowsCount={clientRowsCount}
        onSelectAll={selectAll}
        addRowProps={addRowProps}
        rows={filteredFeed}
        hasSearchActive={hasSearchActive}
        onToggleSelect={(id, kind) => toggleSelect(id, kind)}
        onOpenConfirm={(row, idx) => row.kind === "mouvement" ? openConfirm(row, idx) : null}
        onOpenEdit={openEdit}
        onOpenProductHistory={(row) => {
          const desName = row.designation_name;
          const desId = row.designation_id ?? null;
          setHistoryDesignation({ id: desId, name: desName });
          setHistoryOpen(true);
        }}
        onOpenPay={(row) => {
          // Trouver le mouvement parent si 'paiement', sinon utiliser la ligne
          let mv = null;
          if (row.kind === "mouvement") {
            mv = row;
          } else if (row.kind === "paiement" && row.mouvement_id) {
            mv = mouvements.find((m) => m.id === row.mouvement_id) || null;
          }
          if (mv) { setPayContext(mv); setPayOpen(true); }
        }}
        onOpenClientHistory={(row) => {
          const mode = row.kind === "mouvement" ? (normalizeType(row.type) === "entree" ? "entree" : "sortie")
            : "sortie"; // défaut pour paiements vers historique ventes
          setClientHistoryMode(mode);
          setClientHistoryEntity({ id: row.client_id ?? null, name: row.client_name });
          setClientHistoryOpen(true);
        }}
      />

      {formError && <p className="text-red-500 mt-2">{formError}</p>}
      {formLoading && <p className="text-gray-500 mt-2">Enregistrement...</p>}
      {selectionError && <p className="text-red-600 mt-3">{selectionError}</p>}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
  {hasSelection && sameClientSelection && (
    <button
      onClick={openInvoice}
      className="bg-green-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-green-700 disabled:opacity-50"
      disabled={invoiceLoading}
      title="Générer une facture"
    >
      <DocumentDuplicateIcon className="w-5 h-5" />
      {invoiceLoading ? "Préparation..." : "Facturation"}
    </button>
  )}

  <button
    className="bg-white border px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-50"
    onClick={fetchPointJour}
    disabled={pointJourLoading}
  >
    <BanknotesIcon className="w-5 h-5 text-green-700" />
    {pointJourLoading ? "Chargement..." : "Journal caisse"}
  </button>

  {/* Bouton MAJ SOURCE déplacé en Header pour éviter les doublons */}


<button
  className="bg-white border px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-50"
  onClick={() => setReleveOpen(true)}
  type="button"
>
  Relevé client
</button>
<ClientReleveModal
  open={releveOpen}
  onClose={() => setReleveOpen(false)}
  token={token}
/>


  <button
    className="bg-white border px-4 py-2 rounded flex items-center gap-2 hover:bg-gray-50"
    onClick={() => setDepenseOpen(true)}
  >
    <CurrencyEuroIcon className="w-5 h-5 text-amber-600" />
    Enregistrer une dépense
  </button>

  {/* New buttons */}
  <button
    className="bg-white border px-4 py-2 rounded hover:bg-gray-50"
    onClick={() => setClientsListOpen(true)}
    type="button"
  >
    Clients{clientsTotal != null ? ` (${clientsTotal})` : ''}
  </button>

  <button
    className="bg-white border px-4 py-2 rounded hover:bg-gray-50"
    onClick={() => setProductsListOpen(true)}
    type="button"
  >
    Produits{productsTotal != null ? ` (${productsTotal})` : ''}
  </button>

  <button
    className="bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2"
    onClick={() => setOpenHistorique(true)}
  >
    <ClockIcon className="w-5 h-5 text-white" />
    Historique
  </button>
</div>

      {/* Modales */}
      <ConfirmDeleteModal open={confirmOpen} onClose={closeConfirm} onConfirm={confirmDelete} loading={deleteLoading} error={deleteError} target={deleteTarget} index={deleteIndex} />
      <EditMouvementModal open={editOpen} onClose={closeEdit} onSubmit={saveEdit} loading={editLoading} error={editError} form={editForm} setForm={setEditForm} designationOptions={designationOptions} clientOptions={clientOptions} />
      <ProductHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} designation={historyDesignation} token={token} company={COMPANY} seedLines={mouvements} />
      <ClientHistoryModal open={clientHistoryOpen} onClose={() => setClientHistoryOpen(false)} entity={clientHistoryEntity} mode={clientHistoryMode} token={token} seedLines={mouvements} />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} mouvement={payContext} token={token} />
      <InvoiceModal
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        company={COMPANY}
        clientInfo={clientInfo}
        invoiceNumber={invoiceNumber}
        lines={selectedLines}
        total={selectedTotal}
        amountInWords={amountInWords}
        user={user}
      />

      {/* New list modals */}
      <ClientsListModal open={clientsListOpen} onClose={() => setClientsListOpen(false)} />
      <ProductsListModal open={productsListOpen} onClose={() => setProductsListOpen(false)} />
  {/* Message de MAJ SOURCE retiré (centralisé via Header) */}

      <DepenseModal
        open={depenseOpen}
        onClose={() => setDepenseOpen(false)}
        onCreated={(dep) => {
          // Optionnel: afficher une notification, rafraîchir une liste de dépenses ailleurs, etc.
          console.log('Dépense créée', dep);
        }}
      />

      <PointJourModal
        open={pointJourOpen}
        onClose={() => setPointJourOpen(false)}
        point={pointJour}
        jour={jourCaisse}
        caissier={null}
      />
      {pointJourError && <div className="text-red-500 mt-2">{pointJourError}</div>}
      
     <ModalHistoriqueRecherche
  open={openHistorique}
  onClose={() => setOpenHistorique(false)}
  onEdit={(item) => {
    // fermer l'historique puis ouvrir l'édition
    setOpenHistorique(false);
    setTimeout(() => openEdit(item), 180); // délai pour laisser la modal se fermer
  }}
  onDelete={(item) => {
    setOpenHistorique(false);
    const idx = feed.findIndex(f => f.id === item.id);
    setTimeout(() => openConfirm(item, idx), 180);
  }}
  onUpdateType={async (updatedItem) => {
    // si onUpdateType doit agir inline, laisse la modal ouverte — sinon ferme d'abord
    try {
      const t = localStorage.getItem("token");
      await api.patch(`/api/stockMouvements/${updatedItem.id}`, { type: updatedItem.type }, {
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
      });
      await fetchMouvementsDuJour();
    } catch (err) {
      alert("Impossible de mettre à jour le type : " + (err?.response?.data?.error || err.message));
    }
  }}
/>


    </div>
  );
};

export default StockMouvements;