import React, { useState } from "react";
import { Link, useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { UserPlus, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { formatApiError } from "../lib/api";
import { GlassBackground } from "../components/GlassBackground";
import { LanguageToggle } from "../components/LanguageToggle";

export default function Signup() {
  const { user, signup, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const safeReturn = (() => { const p = searchParams.get("return"); if (!p || typeof p !== "string") return null; if (!p.startsWith("/")) return null; if (p.startsWith("//")) return null; return p; })();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signup(username.trim().toLowerCase(), password, displayName.trim());
      navigate(safeReturn || "/", { replace: true });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-10" data-testid="signup-page">
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
              <div className="gm-chip" data-testid="signup-app-chip">{t("appName")}</div>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            {t("joinGlass")}
          </h1>
          <p className="text-sm text-[var(--gm-text-muted)] mt-2 mb-8">
            {t("joinGlassSub")}
          </p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="signup-form">
            <div>
              <div className="gm-field">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder=" "
                  pattern="^[a-z0-9_]{3,20}$"
                  required
                  data-testid="signup-username-input"
                />
                <label>{t("username")}</label>
              </div>
              <p className="text-[11px] text-[var(--gm-text-muted)] mt-1 ml-2">{t("usernameHint")}</p>
            </div>

            <div className="gm-field">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder=" "
                required
                maxLength={50}
                data-testid="signup-display-name-input"
              />
              <label>{t("displayName")}</label>
            </div>

            <div>
              <div className="gm-field">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder=" "
                  required
                  minLength={6}
                  autoComplete="new-password"
                  data-testid="signup-password-input"
                />
                <label>{t("password")}</label>
              </div>
              <p className="text-[11px] text-[var(--gm-text-muted)] mt-1 ml-2">{t("passwordHint")}</p>
            </div>

            {error && (
              <div
                className="text-sm rounded-xl px-4 py-3"
                style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)", color: "#FFB4B4" }}
                data-testid="signup-error"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="gm-btn-primary w-full"
              data-testid="signup-submit-button"
            >
              {submitting ? t("loading") : (
                <>
                  <UserPlus className="w-4 h-4" />
                  {t("createAccount")}
                </>
              )}
            </button>
          </form>

          <div className="mt-7 text-center text-sm text-[var(--gm-text-muted)]">
            {t("haveAccount")}{" "}
            <Link to={`/login${safeReturn ? `?return=${encodeURIComponent(safeReturn)}` : ""}`} className="gm-link" data-testid="go-to-login-link">
              {t("login")}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
