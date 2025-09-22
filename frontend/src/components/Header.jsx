import React from "react";
import { useNavigate } from "react-router-dom";

export default function Header({ username, userLogo, userNumber, onLogout }) {
  const navigate = useNavigate();

  return (
    <header className="bg-green-700 text-white py-4 px-8 flex justify-between items-center shadow">
      <div className="flex items-center gap-4">
        {/* Logo utilisateur */}
        <img
          src={userLogo || "/default-avatar.png"}
          alt="Avatar utilisateur"
          className="h-10 w-10 rounded-full border object-cover"
        />
        <div className="font-bold text-2xl tracking-wide">Gestion de stock</div>
        {/* Numéro utilisateur */}
        {userNumber && (
          <span className="bg-green-800 px-3 py-1 rounded-full text-xs font-semibold ml-2">
            N° {userNumber}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {username ? (
          <>
            {/* Lien profil/configuration */}
            <button
              className="underline font-medium hover:text-green-200"
              onClick={() => navigate("/profile")}
              title="Paramètres du profil"
            >
              Profil
            </button>
            <span className="font-medium">
              Session : <span className="underline">{username}</span>
            </span>
            <button
              className="p-2 rounded-full hover:bg-green-800 focus:outline-none"
              title="Déconnexion"
              onClick={onLogout}
            >
              {/* Icône de déconnexion SVG */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
              </svg>
            </button>
          </>
        ) : (
          <button className="bg-white text-green-700 px-4 py-2 rounded shadow hover:bg-green-50">
            Connexion
          </button>
        )}
      </div>
    </header>
  );
}