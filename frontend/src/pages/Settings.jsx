import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Camera, Check, LogOut, Languages } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { api, formatApiError } from "../lib/api";
import { GlassBackground } from "../components/GlassBackground";
import { UserAvatar } from "../components/Avatar";

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const saveProfile = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { data } = await api.patch("/users/me", { display_name: displayName, bio });
      setUser(data);
      setSavedAt(Date.now());
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setError("File too large (max 100MB)");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/users/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUser({ ...user, avatar_url: data.avatar_url });
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="relative min-h-screen" data-testid="settings-page">
      <GlassBackground />
      <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-6"
        >
          <button
            onClick={() => navigate("/")}
            className="gm-btn-ghost"
            data-testid="settings-back-button"
          >
            <ArrowLeft className={`w-4 h-4 ${dir === "rtl" ? "rotate-180" : ""}`} />
            {t("backToChats")}
          </button>
          <div className="gm-chip">{t("settings")}</div>
        </motion.div>

        {/* Profile card */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="gm-glass rounded-3xl p-6 sm:p-8"
          data-testid="settings-profile-section"
        >
          <header className="mb-6">
            <h2 className="text-2xl font-semibold text-white">{t("yourProfile")}</h2>
            <p className="text-sm text-[var(--gm-text-muted)] mt-1">{t("aboutYouSub")}</p>
          </header>

          <div className="flex flex-col sm:flex-row sm:items-center gap-5 mb-7">
            <div className="relative">
              <UserAvatar user={user} size={88} ring testId="settings-avatar" />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full flex items-center justify-center text-white"
                style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 8px 20px -6px rgba(59,158,255,0.5)" }}
                aria-label="change avatar"
                data-testid="change-avatar-button"
                disabled={uploading}
              >
                <Camera className="w-4 h-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleAvatar}
                className="hidden"
                data-testid="avatar-file-input"
              />
            </div>
            <div className="min-w-0">
              <div className="text-xl text-white font-semibold" data-testid="settings-display-name">
                {user?.display_name || user?.username}
              </div>
              <div className="text-sm text-[var(--gm-text-muted)] flex items-center gap-2" data-testid="settings-username">
                <span>@{user?.username}</span>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`@${user?.username}`);
                      setSavedAt(Date.now());
                      setError("");
                    } catch (e) {
                      setError("Copy failed");
                    }
                  }}
                  className="p-1 rounded-md hover:bg-white/10 text-[#9ABEFF]"
                  aria-label="copy username"
                  data-testid="copy-username-button"
                  title={t("usernameCopied")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
              {uploading && (
                <div className="text-xs text-[#9ABEFF] mt-2" data-testid="avatar-uploading">{t("uploading")}</div>
              )}
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-4" data-testid="profile-form">
            <div className="gm-field">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder=" "
                maxLength={50}
                required
                data-testid="profile-display-name-input"
              />
              <label>{t("displayName")}</label>
            </div>

            <div className="gm-field">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder=" "
                maxLength={280}
                data-testid="profile-bio-input"
              />
              <label>{t("bio")}</label>
            </div>

            {error && (
              <div
                className="text-sm rounded-xl px-4 py-3"
                style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)", color: "#FFB4B4" }}
                data-testid="settings-error"
              >
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="gm-btn-primary"
                data-testid="profile-save-button"
              >
                {saving ? t("loading") : (
                  <>
                    <Check className="w-4 h-4" />
                    {t("save")}
                  </>
                )}
              </button>
              {savedAt && (
                <span className="text-sm text-[#9ABEFF]" data-testid="profile-saved-indicator">{t("saved")}</span>
              )}
            </div>
          </form>
        </motion.section>

        {/* Appearance / Language */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="gm-glass rounded-3xl p-6 sm:p-8 mt-6"
          data-testid="settings-appearance-section"
        >
          <header className="mb-5">
            <h2 className="text-2xl font-semibold text-white">{t("appearance")}</h2>
            <p className="text-sm text-[var(--gm-text-muted)] mt-1">{t("appearanceSub")}</p>
          </header>

          <div className="flex items-center justify-between gap-4 p-4 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)" }}>
                <Languages className="w-5 h-5 text-[#C9B8FF]" />
              </div>
              <div>
                <div className="text-white font-medium">{t("language")}</div>
                <div className="text-xs text-[var(--gm-text-muted)]">
                  {lang === "en" ? t("english") : t("persian")}
                </div>
              </div>
            </div>

            <div className="flex gap-2" data-testid="language-options">
              <button
                onClick={() => setLang("en")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  lang === "en" ? "text-white" : "text-[var(--gm-text-muted)] hover:text-white"
                }`}
                style={
                  lang === "en"
                    ? { background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 8px 22px -8px rgba(59,158,255,0.55)" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }
                }
                data-testid="lang-en-button"
              >
                EN
              </button>
              <button
                onClick={() => setLang("fa")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all`}
                style={
                  lang === "fa"
                    ? { background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 8px 22px -8px rgba(59,158,255,0.55)", color: "#fff", fontFamily: "Vazirmatn" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "var(--gm-text-muted)", fontFamily: "Vazirmatn" }
                }
                data-testid="lang-fa-button"
              >
                فارسی
              </button>
            </div>
          </div>
        </motion.section>

        {/* Account / logout */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15 }}
          className="gm-glass rounded-3xl p-6 sm:p-8 mt-6 mb-8"
          data-testid="settings-account-section"
        >
          <header className="mb-5">
            <h2 className="text-2xl font-semibold text-white">{t("dangerZone")}</h2>
            <p className="text-sm text-[var(--gm-text-muted)] mt-1">{t("dangerZoneSub")}</p>
          </header>
          <button
            onClick={onLogout}
            className="gm-btn-ghost"
            style={{ color: "#FFB4B4", borderColor: "rgba(255,80,80,0.25)" }}
            data-testid="logout-button"
          >
            <LogOut className="w-4 h-4" />
            {t("logout")}
          </button>
        </motion.section>
      </div>
    </div>
  );
}
