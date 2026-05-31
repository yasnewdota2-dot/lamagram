import React, { useEffect, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Search, X, Plus, MessageSquare, Users, Megaphone, LinkIcon, Sun, Moon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { useMessengerActions } from "../lib/messenger";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { GlassBackground } from "../components/GlassBackground";
import { UserAvatar } from "../components/Avatar";
import { ChatList } from "../components/Messenger/ChatList";
import { SearchResults } from "../components/Messenger/SearchResults";
import { ChatPanel } from "../components/Messenger/ChatPanel";
// Phase 13 — lazy-load dialogs that only open on user action (smaller initial JS)
const NewGroupDialog = lazy(() => import("../components/Messenger/GroupDialogs").then((m) => ({ default: m.NewGroupDialog })));
const NewChannelDialog = lazy(() => import("../components/Messenger/NewChannelDialog").then((m) => ({ default: m.NewChannelDialog })));
const JoinDialog = lazy(() => import("../components/Messenger/JoinDialog").then((m) => ({ default: m.JoinDialog })));
import { useConversations, useActiveConvId } from "../lib/messenger";
import { useIsMobile } from "../lib/useIsMobile";

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");
  const { openOrCreateConversation, setActiveConv } = useMessengerActions();
  const conversations = useConversations();
  const activeConvId = useActiveConvId();
  const isMobile = useIsMobile();
  const { setActiveConv: setActiveConvFromHome } = { setActiveConv };

  // History integration: push a state when entering a conv, listen for popstate to leave
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeConvId) {
      const cur = window.history.state;
      if (!cur || cur.convId !== activeConvId) {
        window.history.pushState({ convId: activeConvId }, "", window.location.pathname + window.location.search);
      }
    }
  }, [activeConvId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (e) => {
      const st = e.state;
      if (!st || !st.convId) {
        try { setActiveConvFromHome(null); } catch {}
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setActiveConvFromHome]);
  const [query, setQuery] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);

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
        <div className="grid gap-4 lg:gap-6 h-[calc(100vh-1rem)] lg:h-[calc(100vh-3rem)] grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr]">
          {/* Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`gm-glass rounded-3xl p-4 flex flex-col min-h-0 ${activeConvId ? "hidden md:flex" : "flex"}`}
            data-testid="sidebar"
          >
            {/* Profile pill */}
            <div
              className="flex items-center gap-3 p-3 rounded-2xl"
              style={{
                background: "var(--bg-glass)",
                border: "1px solid var(--border-glass)",
              }}
              data-testid="sidebar-profile-card"
            >
              <UserAvatar user={user} size={42} ring testId="sidebar-avatar" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate" style={{ color: "var(--text-primary)" }} data-testid="sidebar-display-name">
                  {user?.display_name || user?.username}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--text-muted)" }} data-testid="sidebar-username">
                  @{user?.username}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-xl transition-colors"
                style={{ background: "transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-glass-strong)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                aria-label="toggle theme"
                data-testid="sidebar-theme-toggle"
              >
                {theme === "light"
                  ? <Moon className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
                  : <Sun className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />}
              </button>
              <Link
                to="/settings"
                className="p-2 rounded-xl transition-colors"
                style={{ background: "transparent" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-glass-strong)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                aria-label="settings"
                data-testid="sidebar-settings-link"
              >
                <SettingsIcon className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
              </Link>
            </div>

            {/* Search */}
            <div className="relative mt-4 flex items-center gap-2" data-testid="sidebar-search">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlain")}
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm"
                  style={{
                    background: "var(--bg-glass)",
                    border: "1px solid var(--border-glass)",
                    color: "var(--text-primary)",
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
                    <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                  </button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-10 w-10 flex items-center justify-center rounded-xl shrink-0 text-white"
                    style={{ background: "var(--accent-gradient)", boxShadow: "0 6px 18px -6px var(--accent-glow)" }}
                    aria-label={t("newChat")}
                    data-testid="sidebar-new-button"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-[160px]"
                  style={{ background: "var(--bg-glass-strong)", backdropFilter: "blur(18px)", border: "1px solid var(--border-glass)", color: "var(--text-primary)" }}
                  data-testid="sidebar-new-menu"
                >
                  <DropdownMenuItem onClick={() => setShowNewGroup(true)} data-testid="sidebar-action-new-group">
                    <Users className="w-4 h-4 mr-2" /> {t("newGroup")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowNewChannel(true)} data-testid="sidebar-action-new-channel">
                    <Megaphone className="w-4 h-4 mr-2" /> {t("newChannel")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Either search results OR chat list */}
            <div className="flex-1 mt-3 overflow-y-auto pr-1 min-h-0">
              {query.trim() ? (
                <>
                  {query.trim().startsWith("@") && (
                    <div className="gm-chip mb-2" data-testid="search-username-hint">
                      {t("searchingUsernames")}
                    </div>
                  )}
                  <SearchResults query={query} onPick={onPickUser} />
                </>
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
            className={`gm-glass rounded-3xl overflow-hidden flex flex-col min-h-0 ${activeConvId ? "flex" : "hidden md:flex"}`}
            data-testid="chat-area"
          >
            <ChatPanel conversation={activeConv} />
          </motion.main>
        </div>
      </div>
      <Suspense fallback={null}>
        {showNewGroup && <NewGroupDialog open={showNewGroup} onOpenChange={setShowNewGroup} />}
        {showNewChannel && <NewChannelDialog open={showNewChannel} onOpenChange={setShowNewChannel} />}
        {showJoinDialog && <JoinDialog open={showJoinDialog} onOpenChange={setShowJoinDialog} />}
      </Suspense>
    </div>
  );
}
