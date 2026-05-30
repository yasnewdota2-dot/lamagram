import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Search, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useMessenger } from "../lib/messenger";
import { GlassBackground } from "../components/GlassBackground";
import { UserAvatar } from "../components/Avatar";
import { ChatList } from "../components/Messenger/ChatList";
import { SearchResults } from "../components/Messenger/SearchResults";
import { ChatPanel } from "../components/Messenger/ChatPanel";

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const {
    conversations,
    activeConvId,
    openOrCreateConversation,
    setActiveConv,
  } = useMessenger();
  const [query, setQuery] = useState("");

  const activeConv = conversations.find((c) => c.id === activeConvId) || null;

  const onPickUser = async (u) => {
    const conv = await openOrCreateConversation(u.id);
    setQuery("");
    await setActiveConv(conv.id);
  };

  return (
    <div className="relative min-h-screen" data-testid="home-page">
      <GlassBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-4 lg:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 lg:gap-6 h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)]">
          {/* Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="gm-glass rounded-3xl p-4 flex flex-col min-h-0"
            data-testid="sidebar"
          >
            {/* Profile pill */}
            <div
              className="flex items-center gap-3 p-3 rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
              data-testid="sidebar-profile-card"
            >
              <UserAvatar user={user} size={42} ring testId="sidebar-avatar" />
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
            <div className="relative mt-4" data-testid="sidebar-search">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gm-text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm text-white"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
                data-testid="sidebar-search-input"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10"
                  aria-label="clear search"
                  data-testid="sidebar-search-clear"
                >
                  <X className="w-4 h-4 text-[var(--gm-text-muted)]" />
                </button>
              )}
            </div>

            {/* Either search results OR chat list */}
            <div className="flex-1 mt-3 overflow-y-auto pr-1 min-h-0">
              {query.trim() ? (
                <SearchResults query={query} onPick={onPickUser} />
              ) : (
                <ChatList />
              )}
            </div>
          </motion.aside>

          {/* Right panel */}
          <motion.main
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
            className="gm-glass rounded-3xl overflow-hidden flex flex-col min-h-0"
            data-testid="chat-area"
          >
            <ChatPanel conversation={activeConv} />
          </motion.main>
        </div>
      </div>
    </div>
  );
}
