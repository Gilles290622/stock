import React from "react";
import { useNavigate } from "react-router-dom";
import StockMouvements from "./StockMouvements";
import Login from "./Login";

export default function StockPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  // Si pas de token, on affiche Login
  if (!token) {
    return <Login />;
  }

  // Sinon, on affiche la page des mouvements de stock
  return <StockMouvements />;
}