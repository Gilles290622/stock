import React, { useState } from "react";
import api from "../api/axios";

export default function ProfileSettings({ user, onUpdate }) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [entreprise, setEntreprise] = useState(user.entreprise || "");
  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || "");
  const [logo, setLogo] = useState(user.logo || "");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleLogoChange = (e) => {
    const f = e.target.files[0];
    if (f && f.type.startsWith("image/")) {
      setFile(f);
      // Affiche un preview local avant upload
      const reader = new FileReader();
      reader.onloadend = () => setLogo(reader.result);
      reader.readAsDataURL(f);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    let logoUrl = logo; // Par défaut, l'ancien logo

    try {
      // Upload du fichier si présent
      if (file) {
        const formData = new FormData();
        formData.append("logo", file);
        const res = await api.post("/api/upload-logo", formData, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        logoUrl = res.data.url || res.data.relativeUrl || logoUrl;
      }

      // Mise à jour du profil (serveur lit req.user.id)
      await api.post("/api/update-profile", {
        full_name: fullName,
        entreprise: entreprise,
        phone_number: phoneNumber,
        logo: logoUrl,
      });

      setSuccess("Profil mis à jour !");
  if (onUpdate) onUpdate({ ...user, full_name: fullName, entreprise, phone_number: phoneNumber, logo: logoUrl });
    } catch (err) {
      const msg = err?.response?.data?.error || "Erreur lors de la mise à jour";
      setError(msg);
    }
  };

  const resolvedLogoSrc =
    logo?.startsWith("/uploads/")
      ? logo // en dev, proxifié par Vite; en prod, le backend peut renvoyer absolu
      : (logo || "/default-avatar.svg");

  const logoPresent = !!(logo && (logo.startsWith('data:') || logo.startsWith('/uploads/') || /^https?:\/\//i.test(logo)));

  return (
    <div className="max-w-xl mx-auto mt-8 bg-white rounded shadow-md p-8">
      <h2 className="text-2xl font-bold mb-4 text-green-800">Paramètres du profil</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4 flex items-center gap-4">
          <img
            src={resolvedLogoSrc}
            alt="Logo utilisateur"
            className="h-20 w-20 rounded-full border object-cover"
          />
          <input
            type="file"
            accept="image/*"
            className="block"
            onChange={handleLogoChange}
          />
          <span className={`text-xs font-medium px-2 py-1 rounded border ${logoPresent ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {logoPresent ? 'Logo chargé' : 'Aucun logo'}
          </span>
        </div>
        <div className="mb-4">
          <label className="block mb-1 font-medium">Nom complet</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block mb-1 font-medium">Entreprise</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={entreprise}
            onChange={e => setEntreprise(e.target.value)}
            placeholder="Nom de l'entreprise (optionnel)"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-1 font-medium">Numéro (phone_number)</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={phoneNumber}
            onChange={e => setPhoneNumber(e.target.value)}
            required
          />
        </div>
        {error && <div className="text-red-600 mb-2">{error}</div>}
        {success && <div className="text-green-600 mb-2">{success}</div>}
        <button
          type="submit"
          className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-800"
        >
          Enregistrer
        </button>
      </form>
    </div>
  );
}