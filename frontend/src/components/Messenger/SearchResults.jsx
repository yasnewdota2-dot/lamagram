import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions, useConversations } from "../../lib/messenger";
import { useAuth } from "../../lib/auth";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { GroupAvatar } from "./GroupAvatar";
import { SavedAvatar } from "./ChatList";
import { formatRelative } from "../../lib/time";
import { EmptyState } from "../EmptyState";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightMatch = (text, q) => {
  if (!text || !q) return text;
  const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
  const parts = String(text).split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark
        key={i}
        className="rounded px-0.5"
        style={{ background: "rgba(59,158,255,0.22)", color: "#cfe3ff" }}
      >
        {p}
      </mark>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    )
  );
};

export const SearchResults = ({ query, onPick }) => {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { searchUsers, searchMessagesGlobal, setActiveConv } = useMessengerActions();
  const conversations = useConversations();
  const [people, setPeople] = useState([]);
  const [messageResults, setMessageResults] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const q = query.trim();
  const isAtSearch = q.startsWith("@");

  // People search (existing behavior)
  useEffect(() => {
    let cancelled = false;
    if (!q) {
      setPeople([]);
      setLoadingPeople(false);
      return;
    }
    setLoadingPeople(true);
    const id = setTimeout(async () => {
      try {
        const data = await searchUsers(q);
        if (!cancelled) setPeople(data || []);
      } catch {
        if (!cancelled) setPeople([]);
      } finally {
        if (!cancelled) setLoadingPeople(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, searchUsers]);

  // Global message search (new)
  useEffect(() => {
    let cancelled = false;
    if (!q || isAtSearch) {
      setMessageResults([]);
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    const id = setTimeout(async () => {
      try {
        const data = await searchMessagesGlobal(q);
        if (!cancelled) setMessageResults(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setMessageResults([]);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, isAtSearch, searchMessagesGlobal]);

  // Index of conversations by id for resolving message conv metadata
  const convById = useMemo(() => {
    const m = new Map();
    for (const c of conversations || []) m.set(c.id, c);
    return m;
  }, [conversations]);

  const resolveConvMeta = (convId) => {
    const c = convById.get(convId);
    if (!c) return { name: "—", avatar: null };
    if (c.kind === "saved") return { name: t("savedMessages"), kind: "saved" };
    if (c.kind === "group") return { name: c.group?.title || "Group", kind: "group", group: c.group };
    return { name: c.other_user?.display_name || c.other_user?.username || "—", kind: "dm", other_user: c.other_user };
  };

  const resolveSenderLabel = (m) => {
    if (m.sender_id === user?.id) return t("you");
    const c = convById.get(m.conversation_id);
    if (c?.kind === "dm" && c.other_user) {
      return c.other_user.display_name || c.other_user.username;
    }
    // groups: backend doesn't include sender display; show short id fallback
    return "·";
  };

  const handleMessageResultClick = (m) => {
    try { setActiveConv(m.conversation_id); } catch {}
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("jump-to-message", { detail: m.id }));
    }, 600);
  };

  if (!q) return null;

  const hasPeople = people.length > 0;
  const hasMessages = messageResults.length > 0;
  const isLoading = loadingPeople || loadingMessages;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="mt-3 rounded-2xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
        data-testid="search-results"
      >
        {/* People section */}
        {hasPeople && (
          <section data-testid="search-people-section">
            <div
              className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-[var(--gm-text-muted)]"
              data-testid="search-people-title"
            >
              {t("people")}
            </div>
            {people.map((u) => (
              <button
                key={u.id}
                onClick={() => onPick(u)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.06] transition-colors"
                data-testid={`search-result-${u.username}`}
              >
                <div className="relative">
                  <UserAvatar user={u} size={36} />
                  {u.is_online && (
                    <span className="absolute -bottom-0.5 right-0">
                      <OnlineDot online size={9} />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium truncate">{u.display_name}</div>
                  <div className="text-xs text-[var(--gm-text-muted)] truncate">@{u.username}</div>
                </div>
              </button>
            ))}
          </section>
        )}

        {/* Messages section */}
        {hasMessages && (
          <section data-testid="search-messages-section">
            {hasPeople && <div className="h-px bg-white/5 mx-3" />}
            <div
              className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-[var(--gm-text-muted)]"
              data-testid="search-messages-title"
            >
              {t("messages")}
            </div>
            {messageResults.map((m) => {
              const meta = resolveConvMeta(m.conversation_id);
              const sender = resolveSenderLabel(m);
              return (
                <button
                  key={m.id}
                  onClick={() => handleMessageResultClick(m)}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.06] transition-colors"
                  data-testid="global-message-result"
                >
                  <div className="shrink-0">
                    {meta.kind === "saved" ? (
                      <SavedAvatar size={36} />
                    ) : meta.kind === "group" ? (
                      <GroupAvatar group={meta.group} size={36} />
                    ) : (
                      <UserAvatar user={meta.other_user} size={36} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm font-medium truncate">{meta.name}</div>
                    <div className="text-xs text-[var(--gm-text-muted)] truncate">
                      <span className="text-[#9ABEFF]">{sender}:</span>{" "}
                      {highlightMatch(m.text || "", q)}
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--gm-text-muted)] shrink-0">
                    {formatRelative(m.created_at, lang)}
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {/* Loading / empty states */}
        {isLoading && !hasPeople && !hasMessages && (
          <div className="px-4 py-3 text-xs text-[var(--gm-text-muted)]">{t("loading")}</div>
        )}
        {!isLoading && !hasPeople && !hasMessages && (
          <EmptyState
            icon={Search}
            title={isAtSearch ? t("noUsersFound") : t("noSearchResults")}
            testId="search-no-results"
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
};
