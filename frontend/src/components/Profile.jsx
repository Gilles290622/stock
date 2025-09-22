import React from "react";
import { useNavigate } from "react-router-dom";

export default function Profile({ user, onEdit }) {
  const navigate = useNavigate();

  return (
    <div className="max-w-xl mx-auto mt-8 bg-white rounded shadow-md p-8">
      <h2 className="text-2xl font-bold mb-4 text-green-800">Profil utilisateur</h2>
      <div className="flex items-center gap-6 mb-6">
        <img
          src={user?.logo || "/default-avatar.png"}
          alt="Avatar utilisateur"
          className="h-20 w-20 rounded-full border object-cover"
        />
        <div>
          <div className="font-semibold text-lg">{user?.full_name}</div>
          <div className="text-gray-600">N° {user?.numero}</div>
          <div className="text-gray-600">{user?.email}</div>
          <div className="text-gray-600">{user?.username}</div>
        </div>
      </div>
      <button
        className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-800"
        onClick={() => navigate("/profile/settings")}
      >
        Modifier mon profil
      </button>
    </div>
  );
}