import React, { useState } from "react";

export default function Register({ onRegister }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [numero, setNumero] = useState(""); // numéro utilisateur
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password, full_name: fullName, numero }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        if (onRegister) onRegister(data.user?.username || data.user?.email || "User", data.user);
      } else {
        setError(data.message || "Erreur lors de l'inscription");
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
        <h2 className="text-2xl font-bold text-center text-green-700 mb-6">Créer un compte</h2>
        {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-center">{error}</div>}
        <div className="mb-4">
          <label className="block mb-1 text-green-700 font-medium">Nom complet</label>
          <input
            type="text"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            placeholder="Nom et prénom"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-1 text-green-700 font-medium">Numéro utilisateur</label>
          <input
            type="text"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={numero}
            onChange={e => setNumero(e.target.value)}
            required
            placeholder="Ex: 123456"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-1 text-green-700 font-medium">Email</label>
          <input
            type="email"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block mb-1 text-green-700 font-medium">Nom d'utilisateur</label>
          <input
            type="text"
            className="w-full border border-green-300 rounded px-3 py-2"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
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
          />
        </div>
        <button
          type="submit"
          className="w-full bg-green-700 text-white py-2 rounded hover:bg-green-800 transition"
          disabled={loading}
        >
          {loading ? "Création..." : "Créer un compte"}
        </button>
        <div className="text-center mt-4">
          <a href="/login" className="text-green-600 hover:underline text-sm">
            Déjà un compte ? Se connecter
          </a>
        </div>
      </form>
    </div>
  );
}