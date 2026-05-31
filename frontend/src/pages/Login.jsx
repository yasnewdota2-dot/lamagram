import React, { useState } from "react";
import { Link, useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { formatApiError } from "../lib/api";
import { GlassBackground } from "../components/GlassBackground";
import { LanguageToggle } from "../components/LanguageToggle";

export default function Login() {
  const { user, login, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const safeReturn = (() => { const p = searchParams.get("return"); if (!p || typeof p !== "string") return null; if (!p.startsWith("/")) return null; if (p.startsWith("//")) return null; return p; })();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username.trim().toLowerCase(), password);
      navigate(safeReturn || "/", { replace: true });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center px-4 py-10" data-testid="login-page">
      <GlassBackground />
      <div className="absolute top-5 right-5 z-10">
        <LanguageToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="gm-glass rounded-3xl p-8 sm:p-10">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="gm-chip" data-testid="login-app-chip">{t("appName")}</div>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            {t("welcomeBack")}
          </h1>
          <p className="text-sm text-[var(--gm-text-muted)] mt-2 mb-8">
            {t("welcomeBackSub")}
          </p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
            <div className="gm-field">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder=" "
                autoComplete="username"
                required
                data-testid="login-username-input"
              />
              <label>{t("username")}</label>
            </div>

            <div className="gm-field">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=" "
                autoComplete="current-password"
                required
                data-testid="login-password-input"
              />
              <label>{t("password")}</label>
            </div>

            {error && (
              <div
                className="text-sm rounded-xl px-4 py-3"
                style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)", color: "#FFB4B4" }}
                data-testid="login-error"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="gm-btn-primary w-full"
              data-testid="login-submit-button"
            >
              {submitting ? t("loading") : (
                <>
                  <LogIn className="w-4 h-4" />
                  {t("login")}
                </>
              )}
            </button>
          </form>

          <div className="mt-7 text-center text-sm text-[var(--gm-text-muted)]">
            {t("noAccount")}{" "}
            <Link to={`/signup${safeReturn ? `?return=${encodeURIComponent(safeReturn)}` : ""}`} className="gm-link" data-testid="go-to-signup-link">
              {t("signup")}
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--gm-text-muted)] mt-6 tracking-wide">
          {t("tagline")}
        </p>
      </motion.div>
    </div>
  );
}
