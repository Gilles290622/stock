import React, { useState, useEffect } from "react";
import pkg from '../package.json';
import api from './api/axios';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import StockMouvements from "./components/StockMouvements";
import AdminDashboard from "./components/admin/AdminDashboard";
import Login from "./components/Login";
import Register from "./components/Register";
import Profile from "./components/Profile";
import ProfileSettings from "./components/ProfileSettings";
import FullScreenLoader from "./components/FullScreenLoader";

// Simule la récupération du user depuis le token/localStorage
function getUserFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.id,
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
  const [appVersion, setAppVersion] = useState(null);
  const [serverVersion, setServerVersion] = useState(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [autoSync, setAutoSync] = useState({ running: false, percent: 0, detail: '' });
  const [autoPull, setAutoPull] = useState({ running: false, percent: 0, detail: '' });
  const [needImmediateReload, setNeedImmediateReload] = useState(false);
  const BUILD_VERSION = pkg.version;
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    // D'abord décoder token pour id minimal
    setUser(getUserFromToken(token));
    // Puis récupérer profil complet (logo inclus)
    (async () => {
      try {
  const { data } = await api.get('/api/me');
        if (data?.user) {
          if (data.user.logo) {
            try { localStorage.setItem('user_logo', data.user.logo); } catch {}
          }
            setUser(prev => ({ ...prev, ...data.user }));
        }
      } catch (e) {
        // silencieux, on laisse le token deco si 401
      }
    })();
  }, []);

  // Désactivation de la synchro auto au rafraîchissement: on ne lance plus auto-PULL ici.

  // Désactivation de l’auto-PUSH également tant que la manip est en cours.

  // Version polling (toutes les 5 minutes) — évite les boucles de reload
  useEffect(() => {
    let stopped = false;
    async function fetchVersion(initial = false) {
      try {
        const { data } = await api.get('/api/version');
        if (stopped) return;
        const serverVer = data?.version || null;
        if (initial) setAppVersion(BUILD_VERSION);
        setServerVersion(serverVer);
        if (!serverVer) return;
        const lastServer = (typeof localStorage !== 'undefined') ? localStorage.getItem('last_server_version') : null;
        const changed = !lastServer || lastServer !== serverVer;
        if (changed) {
          try { localStorage.setItem('last_server_version', serverVer); } catch {}
          // Admin: rechargement unique par session pour appliquer la nouvelle version
          const isAdmin = user?.role === 'admin';
          const reloadDone = (typeof sessionStorage !== 'undefined') && sessionStorage.getItem('versionReloadDone') === '1';
          if (isAdmin && !reloadDone) {
            try { sessionStorage.setItem('versionReloadDone', '1'); } catch {}
            applyUpdateNow(serverVer);
            return;
          }
          // Autres rôles: afficher une bannière
          setShowUpdateBanner(true);
          if (!user && isAdmin) setNeedImmediateReload(true);
        }
      } catch { /* ignore */ }
    }
    fetchVersion(true);
    const id = setInterval(() => fetchVersion(false), 5 * 60 * 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [user?.role]);

  function applyUpdateNow(ver) {
    // Reload avec cache-busting pour garantir la dernière version servie
    const v = ver || serverVersion || Date.now();
    window.location.assign(`/?v=${encodeURIComponent(v)}`);
  }
  // Si l'on découvre après coup que l'utilisateur est admin et qu'une MAJ est dispo, recharger
  useEffect(() => {
    if (needImmediateReload && user?.role === 'admin' && serverVersion && BUILD_VERSION && serverVersion !== BUILD_VERSION) {
      applyUpdateNow(serverVersion);
      setNeedImmediateReload(false);
    }
  }, [needImmediateReload, user?.role, serverVersion]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    navigate("/login");
  };

  const handleLogin = (name, userObj) => {
    if (userObj?.logo) {
      try { localStorage.setItem('user_logo', userObj.logo); } catch {}
    }
    setUser({
      ...userObj,
      logo: localStorage.getItem('user_logo') || userObj.logo || '',
      numero: localStorage.getItem('user_numero') || userObj.numero || '',
    });
  };

  const handleProfileUpdate = (updatedUser) => {
    if (updatedUser?.logo) {
      try { localStorage.setItem('user_logo', updatedUser.logo); } catch {}
    }
    setUser({ ...user, ...updatedUser });
  };

  // PrivateRoute pour protéger les routes sensibles
  const PrivateRoute = ({ children }) => {
    return user ? children : <Navigate to="/login" />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {(autoPull.running || autoSync.running) && (
        <FullScreenLoader title="Synchronisation avec la base distante" percent={autoSync.running ? autoSync.percent : autoPull.percent} detail={autoSync.running ? autoSync.detail : autoPull.detail} />
      )}
      <Header
        username={user?.username}
        userLogo={user?.logo}
        userNumber={user?.numero}
        onLogout={handleLogout}
        showSync={true}
        userId={user?.id}
        role={user?.role}
        entreprise={user?.entreprise}
      />
      {showUpdateBanner && (
        <div className="border-b border-amber-300 bg-amber-50 text-amber-900 text-sm">
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
            <div className="truncate">Une nouvelle version de l'application est disponible (serveur {serverVersion}, vous {appVersion}).</div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={applyUpdateNow} className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs hover:bg-amber-700 shadow-sm">Recharger</button>
              <button onClick={() => setShowUpdateBanner(false)} className="px-2.5 py-1.5 text-xs text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100">Plus tard</button>
            </div>
          </div>
        </div>
      )}
      <main className="flex-1 w-full">
        <div className="max-w-7xl mx-auto w-full px-6 py-6">
        <Routes>
          <Route
            path="/"
            element={
              <PrivateRoute>
                {user?.role === 'admin' ? (
                  <Navigate to="/admin" />
                ) : (
                  <StockMouvements user={user} />
                )}
              </PrivateRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PrivateRoute>
                <AdminDashboard user={user} />
              </PrivateRoute>
            }
          />
          <Route
            path="/login"
            element={
              user
                ? <Navigate to="/" />
                : <Login onLogin={handleLogin} />
            }
          />
          <Route
            path="/register"
            element={
              user
                ? <Navigate to="/" />
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
            path="/home"
            element={
              user
                ? <Navigate to="/" />
                : <Navigate to="/login" />
            }
          />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}