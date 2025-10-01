import React, { useState, useEffect } from "react";
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

  // Auto-sync on app open (non-admin only): stream progress via SSE
  useEffect(() => {
    if (!user || user.role === 'admin') return;
    let aborted = false;
    let es;
    async function start() {
      try {
        setAutoSync({ running: true, percent: 0, detail: 'Initialisation…' });
        // Build authenticated SSE URL with token (Authorization headers aren’t supported by native EventSource)
        const t = localStorage.getItem('token');
        const url = `/api/sync/push/progress?token=${encodeURIComponent(t)}`;
        es = new EventSource(url);
        es.addEventListener('start', (e) => {
          try { const d = JSON.parse(e.data); setAutoSync({ running: true, percent: 0, detail: 'Démarrage…' }); } catch {}
        });
        es.addEventListener('progress', (e) => {
          try {
            const d = JSON.parse(e.data);
            const label = d.step ? String(d.step) : '';
            setAutoSync({ running: true, percent: Number(d.percent || 0), detail: label });
          } catch {}
        });
        es.addEventListener('error', (e) => {
          setAutoSync(prev => ({ ...prev, detail: 'Erreur de synchronisation' }));
        });
        es.addEventListener('done', (e) => {
          setAutoSync({ running: false, percent: 100, detail: 'Terminé' });
          try { es?.close(); } catch {}
        });
      } catch {
        setAutoSync({ running: false, percent: 0, detail: '' });
        try { es?.close(); } catch {}
      }
    }
    start();
    return () => { aborted = true; try { es?.close(); } catch {} };
  }, [user?.id, user?.role]);

  // Version polling (toutes les 5 minutes)
  useEffect(() => {
    let stopped = false;
    async function fetchVersion(initial = false) {
      try {
        const { data } = await api.get('/api/version');
        if (!stopped) {
          if (initial) setAppVersion(data.version);
          setServerVersion(data.version);
          if (!initial && appVersion && data.version && data.version !== appVersion) {
            setShowUpdateBanner(true);
          }
        }
      } catch {/* ignore */}
    }
    fetchVersion(true);
    const id = setInterval(fetchVersion, 5 * 60 * 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [appVersion]);

  function applyUpdateNow() {
    // Force reload (cache-bust via hash build)
    window.location.reload();
  }

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
    <div className="min-h-screen flex flex-col bg-white">
      {autoSync.running && (
        <FullScreenLoader title="Synchronisation avec la base distante" percent={autoSync.percent} detail={autoSync.detail} />
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
        <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm flex items-center justify-between px-4 py-2">
          <div>Une nouvelle version de l'application est disponible (serveur {serverVersion}, vous {appVersion}).</div>
          <div className="flex items-center gap-2">
            <button onClick={applyUpdateNow} className="px-3 py-1 rounded bg-yellow-600 text-white text-xs hover:bg-yellow-700">Recharger</button>
            <button onClick={() => setShowUpdateBanner(false)} className="px-2 py-1 text-xs text-yellow-700 hover:underline">Plus tard</button>
          </div>
        </div>
      )}
      <main className="flex-1 container mx-auto p-6">
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