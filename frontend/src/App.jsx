import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import StockMouvements from "./components/StockMouvements";
import Login from "./components/Login";
import Register from "./components/Register";
import Profile from "./components/Profile";
import ProfileSettings from "./components/ProfileSettings";

// Simule la récupération du user depuis le token/localStorage
function getUserFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      username: payload.username || payload.email || "Utilisateur",
      full_name: payload.full_name || payload.username || "",
      email: payload.email || "",
      numero: payload.numero || localStorage.getItem("user_numero") || "",
      logo: localStorage.getItem("user_logo") || payload.logo || "",
    };
  } catch {
    return null;
  }
}

function AppContent() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      setUser(getUserFromToken(token));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    navigate("/login");
  };

  const handleLogin = (name, userObj) => {
    setUser({
      ...userObj,
      logo: localStorage.getItem("user_logo") || userObj.logo || "",
      numero: localStorage.getItem("user_numero") || userObj.numero || "",
    });
  };

  const handleProfileUpdate = (updatedUser) => {
    setUser({ ...user, ...updatedUser });
  };

  // PrivateRoute pour protéger les routes sensibles
  const PrivateRoute = ({ children }) => {
    return user ? children : <Navigate to="/login" />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header
        username={user?.username}
        userLogo={user?.logo}
        userNumber={user?.numero}
        onLogout={handleLogout}
      />
      <main className="flex-1 container mx-auto p-6">
        <Routes>
          <Route
            path="/stock"
            element={
              <PrivateRoute>
                <StockMouvements />
              </PrivateRoute>
            }
          />
          <Route
            path="/login"
            element={
              user
                ? <Navigate to="/stock" />
                : <Login onLogin={handleLogin} />
            }
          />
          <Route
            path="/register"
            element={
              user
                ? <Navigate to="/stock" />
                : <Register onRegister={handleLogin} />
            }
          />
          <Route
            path="/profile"
            element={
              user
                ? <Profile user={user} onEdit={handleProfileUpdate} />
                : <Navigate to="/login" />
            }
          />
          <Route
            path="/profile/settings"
            element={
              user
                ? <ProfileSettings user={user} onUpdate={handleProfileUpdate} />
                : <Navigate to="/login" />
            }
          />
          <Route
            path="/"
            element={
              user
                ? <Navigate to="/stock" />
                : <Navigate to="/login" />
            }
          />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  const basename = (import.meta && import.meta.env && import.meta.env.DEV) ? "/" : "/stock";
  return (
    <Router basename={basename}>
      <AppContent />
    </Router>
  );
}