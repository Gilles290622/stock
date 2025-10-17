import React, { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/axios";

export default function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post('/api/login', { identifier, password });
      if (data?.token) {
        localStorage.setItem("token", data.token);
        if (onLogin) onLogin(data.user?.username || data.user?.email || "User", data.user);
      } else {
        setError(data?.message || "Erreur lors de la connexion");
      }
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || "Erreur de connexion au serveur";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[60vh]">
      <form className="bg-white rounded-lg shadow-lg p-8 w-full max-w-sm border border-green-200"
            onSubmit={handleSubmit}>
        <h2 className="text-2xl font-bold text-center text-green-700 mb-6">Connexion</h2>
        {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-center">{error}</div>}
        <div className="mb-4">
          <label className="block mb-1 text-green-700 font-medium">Email ou nom d'utilisateur</label>
          <input
            type="text"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            required
            autoFocus
            autoComplete="username"
          />
        </div>
        <div className="mb-6">
          <label className="block mb-1 text-green-700 font-medium">Mot de passe</label>
          <input
            type="password"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="text-right mt-1"><button type="button" className="text-xs text-green-700 hover:underline" onClick={()=>{ setResetOpen(true); setResetIdentifier(identifier); setResetMsg(''); }}>Mot de passe oublié ?</button></div>
        </div>
        <button
          type="submit"
          className="w-full bg-green-700 text-white py-2 rounded hover:bg-green-800 transition"
          disabled={loading}
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
        <div className="text-center mt-4">
          <Link to="/register" className="text-green-600 hover:underline text-sm">
            Pas encore de compte ? S'inscrire
          </Link>
        </div>
      </form>
      {resetOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-md">
            <div className="text-lg font-semibold mb-2">Réinitialiser le mot de passe</div>
            {resetMsg && <div className="text-sm mb-2 text-green-700">{resetMsg}</div>}
            <div className="mb-3">
              <label className="block text-sm mb-1">Email ou nom d'utilisateur</label>
              <input className="w-full border rounded px-3 py-2" value={resetIdentifier} onChange={e=>setResetIdentifier(e.target.value)} placeholder="ex: jtservices@local ou Jtservices" />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-2 bg-gray-100 rounded" onClick={()=>setResetOpen(false)}>Annuler</button>
              <button className="px-3 py-2 bg-green-700 text-white rounded" onClick={async()=>{
                try {
                  const res = await fetch('/api/auth/reset-password/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: resetIdentifier }) });
                  const data = await res.json();
                  if (res.ok) setResetMsg(data.message || 'Lien/code de réinitialisation envoyé.');
                  else setResetMsg(data.message || 'Impossible de démarrer la réinitialisation.');
                } catch {
                  setResetMsg('Erreur serveur');
                }
              }}>Envoyer le lien/code</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}