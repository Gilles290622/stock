import React, { useState } from "react";

export default function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        if (onLogin) onLogin(data.user?.username || data.user?.email || "User", data.user);
      } else {
        setError(data.message || "Erreur lors de la connexion");
      }
    } catch {
      setError("Erreur de connexion au serveur");
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
        </div>
        <button
          type="submit"
          className="w-full bg-green-700 text-white py-2 rounded hover:bg-green-800 transition"
          disabled={loading}
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
        <div className="text-center mt-4">
          <a href="/register" className="text-green-600 hover:underline text-sm">
            Pas encore de compte ? S'inscrire
          </a>
        </div>
      </form>
    </div>
  );
}