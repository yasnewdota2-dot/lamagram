import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Search, X, Plus, MessageSquare, Users, Megaphone, LinkIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
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
import { NewGroupDialog } from "../components/Messenger/GroupDialogs";
import { NewChannelDialog } from "../components/Messenger/NewChannelDialog";
import { useConversations, useActiveConvId } from "../lib/messenger";

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { openOrCreateConversation, setActiveConv } = useMessengerActions();
  const conversations = useConversations();
  const activeConvId = useActiveConvId();
  const [query, setQuery] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showJoinPlaceholder, setShowJoinPlaceholder] = useState(false);

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
            <div className="relative mt-4 flex items-center gap-2" data-testid="sidebar-search">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gm-text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder2")}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-2.5 rounded-xl shrink-0 text-white"
                    style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 6px 18px -6px rgba(59,158,255,0.55)" }}
                    aria-label={t("newChat")}
                    data-testid="sidebar-new-button"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-[160px]"
                  style={{ background: "rgba(11,11,18,0.92)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.1)" }}
                  data-testid="sidebar-new-menu"
                >
                  <DropdownMenuItem
                    onClick={() => { setQuery(""); requestAnimationFrame(() => document.querySelector('[data-testid="sidebar-search-input"]')?.focus()); }}
                    data-testid="sidebar-action-new-chat"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" /> {t("newChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowNewGroup(true)} data-testid="sidebar-action-new-group">
                    <Users className="w-4 h-4 mr-2" /> {t("newGroup")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowNewChannel(true)} data-testid="sidebar-action-new-channel">
                    <Megaphone className="w-4 h-4 mr-2" /> {t("newChannel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowJoinPlaceholder(true)} data-testid="sidebar-action-join-by-link">
                    <LinkIcon className="w-4 h-4 mr-2" /> {t("joinByLink")}
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
            className="gm-glass rounded-3xl overflow-hidden flex flex-col min-h-0"
            data-testid="chat-area"
          >
            <ChatPanel conversation={activeConv} />
          </motion.main>
        </div>
      </div>
      <NewGroupDialog open={showNewGroup} onOpenChange={setShowNewGroup} />
      <NewChannelDialog open={showNewChannel} onOpenChange={setShowNewChannel} />
      {showJoinPlaceholder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(7,7,10,0.65)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowJoinPlaceholder(false)}
          data-testid="join-placeholder-dialog"
        >
          <div
            className="rounded-2xl px-8 py-6 text-center"
            style={{ background: "rgba(15,15,22,0.92)", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-white font-semibold mb-1">{t("joinByLink")}</div>
            <div className="text-xs text-white/60">{t("comingSoon")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
