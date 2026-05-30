import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import { MessengerProvider } from "./lib/messenger";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import { ThemeProvider } from "./lib/theme";
import { JoinByTokenPage, JoinByHandlePage } from "./pages/DeepLink";

const Loader = () => (
  <div className="min-h-screen flex items-center justify-center" data-testid="app-loading">
    <div className="gm-glass rounded-2xl px-6 py-4 text-sm text-white/80">Loading…</div>
  </div>
);

const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  return <MessengerProvider>{children}</MessengerProvider>;
};

function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <div className="App">
          <ThemeProvider><BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/join/:token" element={<JoinByTokenPage />} />
              <Route path="/c/:handle" element={<JoinByHandlePage />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Home />
                  </RequireAuth>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <Settings />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter></ThemeProvider>
        </div>
      </AuthProvider>
    </I18nProvider>
  );
}

export default App;
