import React, { memo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bookmark, Pin, BellOff, PinOff, Bell, CheckCheck, Megaphone, Users, MessageCircle, X, Trash2, Ban, Flag, Check } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import {
  useConversations,
  useActiveConvId,
  useTypingForConv,
  useMessengerActions,
} from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { listTime } from "../../lib/time";
import { EmptyState } from "../EmptyState";
import { useLongPress } from "../../lib/useLongPress";

export const SavedAvatar = ({ size = 44, testId }) => {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
        boxShadow: "0 10px 28px -10px rgba(59,158,255,0.55)",
      }}
      data-testid={testId || "saved-avatar"}
    >
      <Bookmark className="text-white" style={{ width: size * 0.46, height: size * 0.46 }} />
    </div>
  );
};

const formatPreview = (lm, t) => {
  if (!lm) return t("newConversation");
  if (lm.type && lm.type !== "text") {
    if (lm.type === "image") return `📷 ${t("photo")}`;
    if (lm.type === "video") return `🎬 ${t("video")}`;
    if (lm.type === "file") return `📎 ${lm.file_name || t("file")}`;
    if (lm.type === "location") return t("lastMsgLocation");
    if (lm.type === "voice") {
      const d = Math.floor(lm.duration_sec || 0);
      return `🎤 ${t("voice")} ${d}s`;
    }
  }
  return lm.text || "";
};

/* Memoized row.
 *
 * `conversation`, `meId`, `isActive`, `lang`, `t`, `setActiveConv` are stable
 * across most state changes. typingMap is read INSIDE via a selector hook so
 * the parent doesn't have to re-render when typing toggles. */
const ChatRow = memo(
  function ChatRow({ conversation, meId, isActive, lang, t, setActiveConv, setPinned, setMuted, markRead, selectionMode, isSelected, onLongPress, onToggleSelect }) {
    const c = conversation;
    const isSaved = c.kind === "saved";
    const isChannel = c.kind === "channel";
    const isGroup = c.kind === "group";
    const other = c.other_user;
    const typingMap = useTypingForConv(isSaved ? null : c.id);
    const typing = !isSaved && other && typingMap[other.id];
    // long-press hook: enters selection mode and selects this row
    const handleLP = useCallback(() => {
      if (isSaved) return; // Saved Messages can't be multi-selected
      onLongPress?.(c.id);
    }, [c.id, isSaved, onLongPress]);
    const lp = useLongPress(handleLP, { threshold: 500 });

    const title = isSaved
      ? t("savedMessages")
      : isChannel
      ? (c.group?.title || "Channel")
      : c.kind === "group"
      ? (c.group?.title || "Group")
      : other?.display_name || other?.username || "Unknown";

    const lastMsg = c.last_message;
    const lastTextRaw = typing
      ? t("typing")
      : lastMsg
      ? `${
          isSaved
            ? ""
            : lastMsg.sender_id === meId
            ? `${t("you")}: `
            : ""
        }${formatPreview(lastMsg, t)}`
      : isSaved
      ? t("savedSubtitle")
      : t("newConversation");

    const testIdSlug = isSaved ? "saved" : other?.username || c.id;

    return (
      <motion.div
        whileTap={{ scale: 0.99 }}
        {...lp}
        onClick={(e) => {
          if (lp.didFire()) return; // long-press already handled
          if (selectionMode) {
            e.preventDefault();
            onToggleSelect?.(c.id);
            return;
          }
          setActiveConv(c.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selectionMode) onToggleSelect?.(c.id);
            else setActiveConv(c.id);
          }
        }}
        role="button"
        tabIndex={0}
        className="group cursor-pointer text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/40 relative transition-colors hover:bg-[var(--bg-glass-strong)] active:scale-[0.99] select-none"
        style={
          isSelected
            ? {
                background: "rgba(59,158,255,0.10)",
                border: "1px solid rgba(59,158,255,0.40)",
                WebkitTouchCallout: "none",
              }
            : { background: "transparent", border: "1px solid transparent", WebkitTouchCallout: "none" }
        }
        data-testid={`chat-list-item-${testIdSlug}`}
        data-active={isActive ? "true" : "false"}
        data-selected={isSelected ? "true" : "false"}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
            style={{ background: "var(--accent-gradient)", boxShadow: "0 0 12px var(--accent-glow)" }}
            data-testid={`chat-list-active-bar-${testIdSlug}`}
          />
        )}
        <div className="relative shrink-0">
          {isSaved ? (
            <SavedAvatar size={44} testId="chat-list-saved-avatar" />
          ) : (
            <>
              <UserAvatar user={other} size={44} />
              {other?.is_online && c.kind === "dm" && (
                <span className="absolute -bottom-0.5 right-0">
                  <OnlineDot online size={11} />
                </span>
              )}
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-white font-medium text-sm truncate flex items-center gap-1.5">
              {title}
              {isChannel && (
                <Megaphone className="w-3 h-3 text-[#9ABEFF] shrink-0" data-testid={`chat-channel-badge-${testIdSlug}`} />
              )}
              {isGroup && (
                <Users className="w-3 h-3 text-[#9ABEFF] shrink-0" data-testid={`chat-group-badge-${testIdSlug}`} />
              )}
              {isSaved && (
                <span
                  className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-md flex items-center gap-0.5"
                  style={{
                    background: "rgba(167,139,250,0.14)",
                    border: "1px solid rgba(167,139,250,0.3)",
                    color: "#C9B8FF",
                  }}
                  data-testid="chat-list-saved-pinned-badge"
                >
                  <Pin className="w-2.5 h-2.5" />
                  {t("pinned")}
                </span>
              )}
              {!isSaved && c.is_pinned && (
                <Pin
                  className="w-3 h-3 text-[#9ABEFF] shrink-0"
                  data-testid={`chat-pin-icon-${testIdSlug}`}
                />
              )}
            </div>
            <div className="text-[10px] text-[var(--gm-text-muted)] shrink-0 flex items-center gap-1">
              {!isSaved && c.is_muted && (
                <BellOff
                  className="w-3 h-3 text-white/45"
                  data-testid={`chat-mute-icon-${testIdSlug}`}
                />
              )}
              {listTime(c.last_message_at || c.created_at, lang)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <div
              className={`text-xs truncate ${
                typing ? "text-[#9ABEFF]" : "text-[var(--gm-text-muted)]"
              }`}
              style={{ unicodeBidi: "plaintext" }}
            >
              {c.is_public && c.handle && !lastTextRaw ? (
                <span className="text-white/40">@{c.handle}</span>
              ) : (
                <>
                  {c.is_public && c.handle && (
                    <span className="text-white/40 mr-1.5">@{c.handle} ·</span>
                  )}
                  {lastTextRaw}
                </>
              )}
            </div>
            {c.unread_count > 0 && (
              <span
                className="text-[10px] font-semibold text-white px-2 py-[2px] rounded-full shrink-0"
                style={
                  c.is_muted
                    ? {
                        background: "rgba(255,255,255,0.18)",
                        boxShadow: "none",
                      }
                    : {
                        background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
                        boxShadow: "0 6px 14px -6px rgba(59,158,255,0.5)",
                      }
                }
                data-testid={`unread-badge-${testIdSlug}`}
              >
                {c.unread_count}
              </span>
            )}
          </div>
        </div>
        {!isSaved && (
          <div className="shrink-0 flex items-center justify-center w-7 h-7">
            {selectionMode && (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={
                  isSelected
                    ? { background: "var(--accent-gradient)", boxShadow: "0 0 10px var(--accent-glow)" }
                    : { background: "transparent", border: "1.5px solid var(--border-glass)" }
                }
                data-testid={`chat-row-select-${testIdSlug}`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  },
  (prev, next) => {
    if (prev.isActive !== next.isActive) return false;
    if (prev.isSelected !== next.isSelected) return false;
    if (prev.selectionMode !== next.selectionMode) return false;
    if (prev.lang !== next.lang) return false;
    if (prev.t !== next.t) return false;
    if (prev.setActiveConv !== next.setActiveConv) return false;
    if (prev.setPinned !== next.setPinned) return false;
    if (prev.setMuted !== next.setMuted) return false;
    if (prev.markRead !== next.markRead) return false;
    if (prev.meId !== next.meId) return false;
    const a = prev.conversation;
    const b = next.conversation;
    if (a === b) return true;
    if (a.id !== b.id) return false;
    if (a.unread_count !== b.unread_count) return false;
    if (a.last_message_at !== b.last_message_at) return false;
    if (a.last_message !== b.last_message) return false;
    if (a.kind !== b.kind) return false;
    if (a.is_pinned !== b.is_pinned) return false;
    if (a.is_muted !== b.is_muted) return false;
    // Phase 26d FAIL 1 — group/channel rename must trigger re-render
    if ((a.group?.title || "") !== (b.group?.title || "")) return false;
    if ((a.group?.avatar_url || "") !== (b.group?.avatar_url || "")) return false;
    if ((a.group?.member_count || 0) !== (b.group?.member_count || 0)) return false;
    const ao = a.other_user, bo = b.other_user;
    if (ao === bo) return true;
    if (!ao || !bo) return false;
    return (
      ao.id === bo.id &&
      ao.display_name === bo.display_name &&
      ao.username === bo.username &&
      ao.avatar_url === bo.avatar_url &&
      ao.is_online === bo.is_online
    );
  }
);

export const ChatList = () => {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const conversations = useConversations();
  const activeConvId = useActiveConvId();
  const { setActiveConv, setPinned, setMuted, markRead, deleteConversation, blockUser, reportUser } = useMessengerActions();

  // Phase 8B — selection mode state
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmAction, setConfirmAction] = useState(null); // "delete" | "block" | "report" | null
  const [reportReason, setReportReason] = useState("");
  const selectionMode = selectedIds.size > 0;

  const handleLongPress = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectedIds(new Set());
    setConfirmAction(null);
    setReportReason("");
  }, []);

  // ESC to exit selection
  React.useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e) => { if (e.key === "Escape") exitSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, exitSelection]);

  const selectedConvs = React.useMemo(
    () => conversations.filter((c) => selectedIds.has(c.id)),
    [conversations, selectedIds]
  );
  const allPinned = selectedConvs.length > 0 && selectedConvs.every((c) => c.is_pinned);
  const allMuted = selectedConvs.length > 0 && selectedConvs.every((c) => c.is_muted);
  const onlyDMs = selectedConvs.length > 0 && selectedConvs.every((c) => c.kind === "dm" || (!c.kind && c.other_user));
  const anyNonDM = selectedConvs.some((c) => c.kind === "group" || c.kind === "channel" || c.kind === "saved");

  const doBulkPin = async () => {
    for (const c of selectedConvs) { try { await setPinned(c.id, !allPinned); } catch {} }
    exitSelection();
  };
  const doBulkMute = async () => {
    for (const c of selectedConvs) { try { await setMuted(c.id, !allMuted); } catch {} }
    exitSelection();
  };
  const doBulkDelete = async () => {
    for (const c of selectedConvs) { try { await deleteConversation(c.id); } catch {} }
    exitSelection();
  };
  const doBulkBlock = async () => {
    for (const c of selectedConvs) {
      const uid = c.other_user?.id;
      if (uid) { try { await blockUser(uid); } catch {} }
    }
    exitSelection();
  };
  const doBulkReport = async () => {
    for (const c of selectedConvs) {
      const uid = c.other_user?.id;
      if (uid) { try { await reportUser(uid, reportReason); } catch {} }
    }
    exitSelection();
  };

  if (!conversations || conversations.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title={t("noConversations")}
        testId="chat-list-empty"
      />
    );
  }

  return (
    <>
      {selectionMode && (
        <div
          className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-2 rounded-2xl mb-2"
          style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", backdropFilter: "blur(16px)" }}
          data-testid="chat-selection-toolbar"
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={exitSelection}
              className="p-1.5 rounded-lg hover:bg-white/10"
              aria-label="close selection"
              data-testid="selection-close"
            >
              <X className="w-4 h-4" style={{ color: "var(--text-primary)" }} />
            </button>
            <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }} data-testid="selection-count">
              {t("selected").replace("{n}", String(selectedIds.size))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={doBulkPin}
              className="p-1.5 rounded-lg hover:bg-white/10"
              aria-label={allPinned ? t("unpin") : t("pinToTop")}
              title={allPinned ? t("unpin") : t("pinToTop")}
              data-testid="selection-pin"
            >
              {allPinned ? <PinOff className="w-4 h-4" style={{ color: "var(--text-secondary)" }} /> : <Pin className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />}
            </button>
            <button
              onClick={doBulkMute}
              className="p-1.5 rounded-lg hover:bg-white/10"
              aria-label={allMuted ? t("unmute") : t("muteNotifications")}
              title={allMuted ? t("unmute") : t("muteNotifications")}
              data-testid="selection-mute"
            >
              {allMuted ? <Bell className="w-4 h-4" style={{ color: "var(--text-secondary)" }} /> : <BellOff className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />}
            </button>
            <button
              disabled={!onlyDMs}
              onClick={() => setConfirmAction("block")}
              className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("block")}
              title={t("block")}
              data-testid="selection-block"
            >
              <Ban className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            </button>
            <button
              disabled={anyNonDM}
              onClick={() => setConfirmAction("delete")}
              className="p-1.5 rounded-lg hover:bg-red-500/15 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("deleteChat")}
              title={t("deleteChat")}
              data-testid="selection-delete"
            >
              <Trash2 className="w-4 h-4" style={{ color: "#E5484D" }} />
            </button>
            <button
              disabled={!onlyDMs}
              onClick={() => setConfirmAction("report")}
              className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("report")}
              title={t("report")}
              data-testid="selection-report"
            >
              <Flag className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        </div>
      )}

      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setConfirmAction(null)}
          data-testid="selection-confirm-overlay"
        >
          <div
            className="rounded-2xl p-5 max-w-sm w-full"
            style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", backdropFilter: "blur(20px)" }}
            onClick={(e) => e.stopPropagation()}
            data-testid="selection-confirm-dialog"
          >
            <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
              {confirmAction === "delete" && t("deleteChats").replace("{n}", String(selectedIds.size))}
              {confirmAction === "block" && t("block") + " · " + selectedIds.size}
              {confirmAction === "report" && t("report") + " · " + selectedIds.size}
            </div>
            <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              {confirmAction === "delete" && t("deleteChatsConfirm")}
              {confirmAction === "block" && t("blockUsersConfirm")}
              {confirmAction === "report" && (
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  rows={3}
                  placeholder={t("reportReason")}
                  className="w-full rounded-lg p-2 text-sm"
                  style={{ background: "var(--bg-glass)", border: "1px solid var(--border-glass)", color: "var(--text-primary)" }}
                  data-testid="report-reason-input"
                />
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ color: "var(--text-secondary)" }}
                data-testid="confirm-cancel"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => {
                  if (confirmAction === "delete") doBulkDelete();
                  else if (confirmAction === "block") doBulkBlock();
                  else if (confirmAction === "report") doBulkReport();
                }}
                className="px-3 py-1.5 rounded-lg text-sm text-white"
                style={
                  confirmAction === "delete"
                    ? { background: "#E5484D" }
                    : { background: "var(--accent-gradient)" }
                }
                data-testid="confirm-proceed"
              >
                {confirmAction === "delete" ? t("deleteChat") : confirmAction === "block" ? t("block") : t("report")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1" data-testid="chat-list">
        {conversations.map((c) => (
          <ChatRow
            key={c.id}
            conversation={c}
            meId={user?.id}
            isActive={c.id === activeConvId}
            lang={lang}
            t={t}
            setActiveConv={setActiveConv}
            setPinned={setPinned}
            setMuted={setMuted}
            markRead={markRead}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(c.id)}
            onLongPress={handleLongPress}
            onToggleSelect={handleToggleSelect}
          />
        ))}
      </div>
    </>
  );
};
