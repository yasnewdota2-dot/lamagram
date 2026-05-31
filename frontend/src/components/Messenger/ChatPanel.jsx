import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, Upload, MessageSquareText, Star, MessageSquare, Search as SearchIcon, ArrowLeft, Forward as ForwardIcon, Trash2, Copy as CopyIcon, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import {
  useMessengerActions,
  useMessagesForConv,
  useTypingForConv,
  usePresenceForUser,
  useGroupMembers,
} from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { TypingDots } from "./TypingDots";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { Lightbox } from "./Lightbox";
import { ForwardDialog } from "./ForwardDialog";
import { GroupInfoDialog } from "./GroupDialogs";
import { ChannelInfoDialog } from "./ChannelInfoDialog";
import { useIsMobile } from "../../lib/useIsMobile";
import { GroupAvatar } from "./GroupAvatar";
import { StarredView } from "./StarredView";
import { ChatSearchBar } from "./ChatSearchBar";
import { SavedAvatar } from "./ChatList";
import { Hand, MessageCircle } from "lucide-react";
import { EmptyState as EmptyChip } from "../EmptyState";
import { useUserProfile } from "./UserProfileDrawer";
import { PinnedMessagesBar } from "./PinnedMessagesBar";
import { formatRelative, isWithinMinutes, dayKey, relativeDayLabel } from "../../lib/time";

export const EmptyState = () => {
  const { t } = useI18n();
  return (
    <div
      className="w-full h-full flex items-center justify-center px-8 py-10 text-center"
      data-testid="chat-empty-state"
    >
      <div className="max-w-md">
        <div
          className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{
            background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
            boxShadow: "0 20px 60px -10px rgba(59,158,255,0.5)",
          }}
        >
          <MessageSquareText className="w-7 h-7 text-white" />
        </div>
        <div className="gm-chip mb-4">{t("appName")}</div>
        <h2 className="text-3xl font-bold text-white tracking-tight">
          {t("selectChat")}
        </h2>
        <p className="mt-3 text-sm text-[var(--gm-text-muted)]">
          {t("selectChatSub")}
        </p>
      </div>
    </div>
  );
};

export const ChatPanel = ({ conversation }) => {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { uploadMedia } = useMessengerActions();
  const { setReplyTarget, setEditTarget, deleteMessage } = useMessengerActions();
  const { setActiveConv, loadGroupMembers } = useMessengerActions();
  const isMobile = useIsMobile();
  const { openUserProfile } = useUserProfile();
  const convId = conversation?.id;
  const messages = useMessagesForConv(convId);
  const typingMap = useTypingForConv(convId);
  const other = conversation?.other_user;
  const livePres = usePresenceForUser(other?.id);
  const groupMembers = useGroupMembers(convId);
  const scrollRef = useRef(null);
  const prevLenRef = useRef(0);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [pendingNew, setPendingNew] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState("");
  // Phase 10 — universal toast auto-dismiss (5s) so error/info banners can't
  // get stuck on screen waiting for another action to clear them.
  React.useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const [forwardSource, setForwardSource] = useState(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [channelInfoOpen, setChannelInfoOpen] = useState(false);
  const [savedTab, setSavedTab] = useState("notes"); // 'notes' | 'starred'
  const [searchOpen, setSearchOpen] = useState(false);
  // Phase 9C — multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMap, setSelectedMap] = useState({}); // { [msgId]: messageObj }
  const [multiForwardSrc, setMultiForwardSrc] = useState(null); // array of messages
  const [multiDeleteOpen, setMultiDeleteOpen] = useState(false);
  const [multiDeleteAll, setMultiDeleteAll] = useState(false);

  // Reset selection whenever the active conversation changes
  React.useEffect(() => {
    setSelectionMode(false);
    setSelectedMap({});
  }, [convId]);

  const exitSelection = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedMap({});
  }, []);
  const enterSelection = React.useCallback((m) => {
    setSelectionMode(true);
    setSelectedMap((p) => ({ ...p, [m.id]: m }));
  }, []);
  const toggleSelect = React.useCallback((m) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[m.id]) { delete next[m.id]; }
      else { next[m.id] = m; }
      if (Object.keys(next).length === 0) setSelectionMode(false);
      return next;
    });
  }, []);
  const selectedList = React.useMemo(
    () => Object.values(selectedMap).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [selectedMap]
  );
  const selectedCount = selectedList.length;

  const handleMultiCopy = React.useCallback(async () => {
    const text = selectedList.map((m) => m.text || "").filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setToast(t("copied"));
    } catch {
      setToast(t("copy"));
    }
    exitSelection();
  }, [selectedList, exitSelection, t]);

  const handleMultiForward = React.useCallback(() => {
    if (selectedCount === 0) return;
    setMultiForwardSrc(selectedList);
  }, [selectedCount, selectedList]);

  const handleMultiDeleteConfirm = React.useCallback(async () => {
    const scope = multiDeleteAll ? "all" : "me";
    setMultiDeleteOpen(false);
    for (const m of selectedList) {
      try { await deleteMessage(m.id, scope, convId); }
      catch { /* continue */ }
    }
    setMultiDeleteAll(false);
    exitSelection();
  }, [multiDeleteAll, selectedList, deleteMessage, convId, exitSelection]);

  const handleReply = React.useCallback(
    (m) => setReplyTarget(convId, m),
    [convId, setReplyTarget]
  );
  const handleEdit = React.useCallback(
    (m) => setEditTarget(convId, m),
    [convId, setEditTarget]
  );
  const handleForward = React.useCallback((m) => setForwardSource(m), []);
  const handleDelete = React.useCallback(
    async (m, scope) => {
      if (scope === "all") {
        if (!window.confirm(t("confirmDeleteAll"))) return;
      }
      try {
        await deleteMessage(m.id, scope, convId);
      } catch (e) {
        setToast(e?.response?.data?.detail || e.message);
      }
    },
    [convId, deleteMessage, t]
  );
  const handleJumpToReply = React.useCallback(
    (msgId) => {
      const el = scrollRef.current?.querySelector(`[data-testid^="message-"][data-msgid="${msgId}"]`);
      if (!el) {
        setToast(t("messageNotInView"));
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background 0.4s";
      el.style.background = "rgba(59,158,255,0.18)";
      setTimeout(() => { el.style.background = "transparent"; }, 900);
    },
    [t]
  );

  const isOnline = livePres ? livePres.is_online : !!other?.is_online;
  const lastSeen = livePres?.last_seen || other?.last_seen;
  const otherTyping = !!(other && typingMap[other.id]);

  // Phase 9C — group typing with names (uses cached groupMembers map)
  const groupTypingLabel = React.useMemo(() => {
    if (conversation?.kind !== "group") return null;
    const typerIds = Object.keys(typingMap || {}).filter(
      (uid) => typingMap[uid] && uid !== user?.id
    );
    if (typerIds.length === 0) return null;
    const labelFor = (uid) =>
      groupMembers?.[uid]?.display_name ||
      groupMembers?.[uid]?.username ||
      `User ${String(uid).slice(0, 6)}`;
    if (typerIds.length === 1) {
      return t("typingOne").replace("{a}", labelFor(typerIds[0]));
    }
    if (typerIds.length === 2) {
      return t("typingTwo")
        .replace("{a}", labelFor(typerIds[0]))
        .replace("{b}", labelFor(typerIds[1]));
    }
    return t("typingPlural").replace("{n}", String(typerIds.length));
  }, [conversation?.kind, typingMap, groupMembers, user?.id, t]);

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    scrollToBottom(false);
    prevLenRef.current = messages.length;
    setPendingNew(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // Listen for global jump-to-message events (from sidebar global search)
  useEffect(() => {
    const handler = (e) => {
      const mid = e?.detail;
      if (mid) handleJumpToReply(mid);
    };
    window.addEventListener("jump-to-message", handler);
    return () => window.removeEventListener("jump-to-message", handler);
  }, [handleJumpToReply]);

  // Lazy-load group members (one fetch per group conv, cached)
  useEffect(() => {
    if (conversation?.kind === "group" && convId) {
      loadGroupMembers(convId);
    }
  }, [conversation?.kind, convId, loadGroupMembers]);

  useEffect(() => {
    const len = messages.length;
    if (len === prevLenRef.current) return;
    const added = len - prevLenRef.current;
    prevLenRef.current = len;
    if (added <= 0) return;
    const last = messages[len - 1];
    const mine = last?.sender_id === user?.id;
    if (autoScroll || mine) {
      scrollToBottom(true);
      setPendingNew(0);
    } else {
      setPendingNew((n) => n + added);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, autoScroll, user?.id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
    if (atBottom) setPendingNew(0);
  };

  // Drag-and-drop
  const onDragOver = (e) => {
    if (!convId) return;
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = (e) => {
    if (e.target === e.currentTarget) setDragOver(false);
  };
  const onDrop = async (e) => {
    if (!convId) return;
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setToast(t("fileTooLarge"));
      setTimeout(() => setToast(""), 3000);
      return;
    }
    try {
      await uploadMedia(convId, file);
    } catch (err) {
      setToast(err?.response?.data?.detail || t("uploadFailed"));
      setTimeout(() => setToast(""), 3000);
    }
  };

  if (!conversation) return <EmptyState />;

  const isSaved = conversation.kind === "saved";
  const isGroup = conversation.kind === "group";
  const isChannel = conversation.kind === "channel";
  const isAdmin = !!conversation.is_admin;

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="chat-panel"
    >
      {/* Phase 9C — Multi-select sticky toolbar overrides the header while active */}
      {selectionMode && (
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ background: "var(--modal-bg)", borderBottom: "1px solid var(--border-glass)", backdropFilter: "blur(16px)" }}
          data-testid="multi-select-toolbar"
        >
          <button onClick={exitSelection} className="p-1.5 rounded-md hover:bg-white/10" aria-label={t("cancel")} data-testid="multi-select-close">
            <X className="w-4 h-4 text-white/85" />
          </button>
          <div className="text-sm text-white font-medium flex-1" data-testid="multi-select-count">
            {t("selectedCountToolbar").replace("{n}", String(selectedCount))}
          </div>
          <button onClick={handleMultiForward} className="p-1.5 rounded-md hover:bg-white/10 text-[#9ABEFF]" aria-label={t("forward")} data-testid="multi-select-forward">
            <ForwardIcon className="w-4 h-4" />
          </button>
          <button onClick={handleMultiCopy} className="p-1.5 rounded-md hover:bg-white/10 text-white/85" aria-label={t("copy")} data-testid="multi-select-copy">
            <CopyIcon className="w-4 h-4" />
          </button>
          <button onClick={() => setMultiDeleteOpen(true)} className="p-1.5 rounded-md hover:bg-white/10 text-red-300" aria-label={t("delete")} data-testid="multi-select-delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: "var(--bg-glass-strong)", borderBottom: "1px solid var(--border-glass)", backdropFilter: "blur(16px)" }}
        data-testid="chat-header"
      >
        {isSaved ? (
          <SavedAvatar size={42} />
        ) : isGroup ? (
          <GroupAvatar group={conversation.group} size={42} testId="chat-header-group-avatar" />
        ) : (
          <div
            className={!isGroup && !isChannel && other ? "relative cursor-pointer" : "relative"}
            onClick={() => { if (!isGroup && !isChannel && other) openUserProfile(other); }}
            data-testid={!isGroup && !isChannel && other ? "chat-header-avatar-trigger" : undefined}
          >
            <UserAvatar user={other} size={42} testId="chat-header-avatar" />
            <span className="absolute -bottom-0.5 right-0">
              <OnlineDot online={isOnline} size={11} testId="chat-header-online-dot" />
            </span>
          </div>
        )}
        {isMobile && (
          <button
            onClick={() => { try { window.history.length > 1 ? window.history.back() : setActiveConv(null); } catch { setActiveConv(null); } }}
            className="p-2 -ml-1 mr-1 rounded-xl text-white/80 hover:bg-white/10 active:scale-95 transition min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={t("back")}
            data-testid="chat-header-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div
          className={`min-w-0 flex-1 ${(isGroup || isChannel || (!isSaved && other)) ? "cursor-pointer" : ""}`}
          onClick={() => {
            if (isGroup) setGroupInfoOpen(true);
            else if (isChannel) setChannelInfoOpen(true);
            else if (!isSaved && other) openUserProfile(other);
          }}
          data-testid={isGroup ? "chat-header-group-title-trigger" : (!isSaved && other ? "chat-header-dm-title-trigger" : undefined)}
        >
          <div className="text-white font-semibold truncate flex items-center gap-2" data-testid="chat-header-name">
            {isSaved ? t("savedMessages") : (isGroup || isChannel) ? (conversation.group?.title || (isChannel ? "Channel" : "Group")) : (other?.display_name || other?.username)}
            {isChannel && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md flex items-center gap-1"
                style={{ background: "rgba(59,158,255,0.14)", border: "1px solid rgba(59,158,255,0.32)", color: "#9ABEFF" }}
                data-testid="chat-header-channel-badge">
                {t("channel") || "Channel"}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--gm-text-muted)] truncate" data-testid="chat-header-presence">
            {isSaved ? (
              <span>{t("savedSubtitle")}</span>
            ) : isChannel ? (
              <span className="flex items-center gap-2" data-testid="chat-header-channel-subtitle">
                <span data-testid="chat-header-subscribers">
                  {t("subscribersCount").replace("{n}", String(conversation.group?.member_count || conversation.participants?.length || 0))}
                </span>
                {conversation.is_public && conversation.handle && (
                  <span className="text-white/40">· @{conversation.handle}</span>
                )}
              </span>
            ) : isGroup ? (
              groupTypingLabel ? (
                <span
                  className="text-[#9ABEFF] flex items-center gap-2"
                  data-testid="chat-header-group-typing"
                >
                  <TypingDots />
                  <span className="truncate">{groupTypingLabel}</span>
                </span>
              ) : (
                <span data-testid="chat-header-group-members">
                  {t("membersCount").replace("{n}", String(conversation.group?.member_count || conversation.participants?.length || 0))}
                </span>
              )
            ) : otherTyping ? (
              <span className="text-[#9ABEFF] flex items-center gap-2">
                <TypingDots />
                {t("typing")}
              </span>
            ) : isOnline ? (
              <span className="flex items-center gap-2">
                <span>{t("online")}</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {lastSeen ? <span>{t("lastSeen")} {formatRelative(lastSeen, lang)}</span> : <span>{t("offline")}</span>}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setSearchOpen((v) => !v); }}
          className={`p-2 rounded-xl transition ${searchOpen ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"}`}
          title={t("searchMessages")}
          aria-label={t("searchMessages")}
          data-testid="chat-header-search-toggle"
        >
          <SearchIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Inline message search */}
      <ChatSearchBar
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        conversationId={convId}
        onJump={(msgId) => handleJumpToReply(msgId)}
      />

      {/* Saved Messages tab strip (Notes / Starred) */}
      {isSaved && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ background: "var(--bg-glass)", borderBottom: "1px solid var(--border-glass)", backdropFilter: "blur(12px)" }}
          data-testid="saved-tab-strip"
        >
          {[
            { key: "notes", label: t("savedNotes") },
            { key: "starred", label: t("starredMessages") },
          ].map((tab) => {
            const active = savedTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setSavedTab(tab.key)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium transition"
                style={
                  active
                    ? {
                        background: "var(--accent-gradient)",
                        color: "white",
                        boxShadow: "0 6px 18px -8px var(--accent-glow)",
                      }
                    : {
                        background: "var(--bg-glass)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-glass)",
                      }
                }
                data-testid={`saved-tab-${tab.key}`}
                data-active={active ? "true" : "false"}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Messages or Starred view (for Saved Messages) */}
      {isSaved && savedTab === "starred" ? (
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-2" data-testid="saved-starred-pane">
          <StarredView
            onJumpTo={(cid, mid) => {
              setActiveConv(cid);
              setTimeout(() => handleJumpToReply(mid), 600);
            }}
          />
        </div>
      ) : (
        <>
        <PinnedMessagesBar
          conversationId={conversation?.id}
          messages={messages}
          onJump={(msgId) => handleJumpToReply(msgId)}
        />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-3 sm:px-5 py-4"
          data-testid="messages-scroll"
        >
        {messages.length === 0 ? (
          <EmptyChip
            icon={Hand}
            title={`${t("sayHi")} ${other?.display_name || other?.username || ""}`.trim()}
            subtitle={t("sayHiSub")}
            testId="empty-conversation"
          />
        ) : (
          messages.map((m, i) => {
            const mine = m.sender_id === user?.id;
            const prev = messages[i - 1];
            const sameSenderWithin2 =
              !!prev &&
              prev.sender_id === m.sender_id &&
              isWithinMinutes(prev.created_at, m.created_at, 2);
            const isFirstInGroup = !sameSenderWithin2;
            const showAvatar = isFirstInGroup;
            const dayChanged = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const isAfterDaySeparator = dayChanged && !!prev;
            // Spacing rules (per spec):
            //  2px when same-sender within 2min, 12px when first-in-group, 24px when after day separator.
            //  First message of the list: no extra margin.
            let mt = 2;
            if (!prev) mt = 0;
            else if (isAfterDaySeparator) mt = 24;
            else if (isFirstInGroup) mt = 12;
            return (
              <React.Fragment key={m.id}>
                {dayChanged && (
                  <div className="gm-day-separator-wrap" data-testid={`day-separator-${dayKey(m.created_at)}`}>
                    <div className="gm-day-separator">{relativeDayLabel(m.created_at, lang, t)}</div>
                  </div>
                )}
                <div data-msgid={m.id} style={{ marginTop: mt }}>
                  <MessageBubble
                    message={m}
                    mine={mine}
                    showAvatar={showAvatar}
                    conversation={conversation}
                    groupMembers={groupMembers}
                    onOpenImage={setLightboxSrc}
                    onReply={handleReply}
                    onForward={handleForward}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onJumpToReply={handleJumpToReply}
                    testId={`message-${m.id}`}
                    selectionMode={selectionMode}
                    isSelected={!!selectedMap[m.id]}
                    onToggleSelect={toggleSelect}
                    onEnterSelection={enterSelection}
                  />
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
      </>
      )}
      {!autoScroll && pendingNew > 0 && !(isSaved && savedTab === "starred") && (
        <button
          onClick={() => {
            scrollToBottom(true);
            setPendingNew(0);
            setAutoScroll(true);
          }}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full text-sm text-white"
          style={{
            background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
            boxShadow: "0 10px 30px -10px rgba(59,158,255,0.55)",
          }}
          data-testid="scroll-to-bottom-pill"
        >
          <ArrowDown className="w-4 h-4" />
          {pendingNew} {t("newMessages")}
        </button>
      )}

      {/* Composer */}
      {isChannel && !isAdmin ? (
        <div
          className="px-5 py-3 text-center text-sm flex items-center justify-center gap-2"
          style={{ background: "var(--bg-glass)", color: "var(--text-secondary)", borderTop: "1px solid var(--border-glass)", backdropFilter: "blur(12px)" }}
          data-testid="channel-post-locked"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
          {t("onlyAdminsCanPost")}
        </div>
      ) : !(isSaved && savedTab === "starred") && (
        <Composer
          conversationId={convId}
          onUploadError={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(""), 3000);
          }}
        />
      )}

      {/* Drag overlay */}
      {dragOver && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(59,158,255,0.18)", border: "2px dashed rgba(59,158,255,0.55)" }}
          data-testid="drop-overlay"
        >
          <div className="text-center text-white">
            <Upload className="w-10 h-10 mx-auto mb-2" />
            <div className="text-lg font-semibold">{t("dropFile")}</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm text-white z-30"
          style={{ background: "rgba(255,80,80,0.16)", border: "1px solid rgba(255,80,80,0.35)" }}
          data-testid="upload-toast"
        >
          {toast}
        </div>
      )}

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      <ForwardDialog
        open={!!forwardSource}
        onOpenChange={(v) => !v && setForwardSource(null)}
        sourceMessage={forwardSource}
        onDone={(n) => {
          const msg = n === 1 ? t("forwardedToOne") : t("forwardedToN").replace("{n}", String(n));
          setToast(msg);
        }}
      />
      <ForwardDialog
        open={!!multiForwardSrc}
        onOpenChange={(v) => { if (!v) { setMultiForwardSrc(null); exitSelection(); } }}
        sourceMessages={multiForwardSrc || []}
        onDone={(n) => {
          const msg = n === 1 ? t("forwardedToOne") : t("forwardedToN").replace("{n}", String(n));
          setToast(msg);
        }}
      />
      {multiDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="multi-delete-modal">
          <div className="w-[min(92vw,420px)] rounded-2xl p-5" style={{ background: "var(--modal-bg)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-base font-semibold mb-2 text-white" data-testid="multi-delete-title">
              {t("multiDeleteTitle").replace("{n}", String(selectedCount))}
            </div>
            <div className="text-xs text-white/55 mb-3">{t("areYouSure")}</div>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={multiDeleteAll}
                onChange={(e) => setMultiDeleteAll(e.target.checked)}
                className="w-4 h-4 accent-[#E5484D]"
                data-testid="multi-delete-for-all"
              />
              <span className="text-sm text-white/85">{t("deleteForEveryone")}</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setMultiDeleteOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5" data-testid="multi-delete-cancel">
                {t("cancel")}
              </button>
              <button onClick={handleMultiDeleteConfirm} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: "#E5484D" }} data-testid="multi-delete-confirm">
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
      {isChannel && (
        <ChannelInfoDialog
          open={channelInfoOpen}
          onOpenChange={setChannelInfoOpen}
          conversation={conversation}
        />
      )}
      {isGroup && (
        <GroupInfoDialog
          open={groupInfoOpen}
          onOpenChange={setGroupInfoOpen}
          conversation={conversation}
        />
      )}
    </div>
  );
};
