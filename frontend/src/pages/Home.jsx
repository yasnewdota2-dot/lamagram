import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, MessageSquareText, Search, Sparkles, Plus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { GlassBackground } from "../components/GlassBackground";
import { UserAvatar } from "../components/Avatar";

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();

  return (
    <div className="relative min-h-screen" data-testid="home-page">
      <GlassBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 min-h-[calc(100vh-3rem)]">
          {/* Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="gm-glass rounded-3xl p-5 flex flex-col"
            data-testid="sidebar"
          >
            {/* Profile pill */}
            <div className="flex items-center gap-3 p-3 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
              data-testid="sidebar-profile-card"
            >
              <UserAvatar user={user} size={44} ring testId="sidebar-avatar" />
              <div className="min-w-0 flex-1">
                <div className="text-white font-semibold truncate" data-testid="sidebar-display-name">
                  {user?.display_name || user?.username}
                </div>
                <div className="text-xs text-[var(--gm-text-muted)] truncate" data-testid="sidebar-username">
                  @{user?.username}
                </div>
              </div>
              <Link
                to="/settings"
                className="p-2 rounded-xl hover:bg-white/10 transition-colors"
                aria-label="settings"
                data-testid="sidebar-settings-link"
              >
                <SettingsIcon className="w-5 h-5 text-[var(--gm-text-muted)]" />
              </Link>
            </div>

            {/* Search */}
            <div className="relative mt-5" data-testid="sidebar-search">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gm-text-muted)]" />
              <input
                placeholder={t("searchPlaceholder")}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-white"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                data-testid="sidebar-search-input"
              />
            </div>

            {/* Chats list (empty / coming soon) */}
            <div className="mt-5 flex-1 flex flex-col">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs uppercase tracking-wider text-[var(--gm-text-muted)]">
                  {t("chatsTitle")}
                </span>
                <button
                  className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--gm-text-muted)]"
                  aria-label="new chat"
                  data-testid="new-chat-button"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center text-center px-4">
                <div>
                  <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                    style={{ background: "rgba(59,158,255,0.10)", border: "1px solid rgba(59,158,255,0.25)" }}>
                    <MessageSquareText className="w-5 h-5 text-[#9ABEFF]" />
                  </div>
                  <p className="text-sm text-[var(--gm-text-muted)]">
                    {t("chatsComingSoon")}
                  </p>
                </div>
              </div>
            </div>
          </motion.aside>

          {/* Main panel */}
          <motion.main
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut", delay: 0.05 }}
            className="gm-glass rounded-3xl p-8 sm:p-12 flex items-center justify-center"
            data-testid="home-main-panel"
          >
            <div className="text-center max-w-xl">
              <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
                style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 20px 60px -10px rgba(59,158,255,0.5)" }}>
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <div className="gm-chip mb-4">{t("appName")}</div>
              <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">
                {t("chatsComingSoon")}
              </h1>
              <p className="mt-4 text-base text-[var(--gm-text-muted)] leading-relaxed">
                {t("chatsComingSoonSub")}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to="/settings" className="gm-btn-primary" data-testid="open-settings-button">
                  <SettingsIcon className="w-4 h-4" />
                  {t("settings")}
                </Link>
              </div>
            </div>
          </motion.main>
        </div>
      </div>
    </div>
  );
}
