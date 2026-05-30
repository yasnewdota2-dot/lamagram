import React, { memo, useState } from "react";
import { motion } from "framer-motion";
import { Bookmark, Pin, BellOff, MoreHorizontal, PinOff, Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
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
  function ChatRow({ conversation, meId, isActive, lang, t, setActiveConv, setPinned, setMuted, markRead }) {
    const c = conversation;
    const isSaved = c.kind === "saved";
    const other = c.other_user;
    const typingMap = useTypingForConv(isSaved ? null : c.id);
    const typing = !isSaved && other && typingMap[other.id];
    const [menuOpen, setMenuOpen] = useState(false);
    const [pinErr, setPinErr] = useState("");

    const title = isSaved
      ? t("savedMessages")
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
      <motion.button
        whileTap={{ scale: 0.99 }}
        onClick={() => setActiveConv(c.id)}
        className="group text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-colors"
        style={
          isActive
            ? {
                background: "rgba(59,158,255,0.10)",
                border: "1px solid rgba(59,158,255,0.28)",
              }
            : {
                background: "transparent",
                border: "1px solid transparent",
              }
        }
        data-testid={`chat-list-item-${testIdSlug}`}
      >
        <div className="relative shrink-0">
          {isSaved ? (
            <SavedAvatar size={44} testId="chat-list-saved-avatar" />
          ) : (
            <>
              <UserAvatar user={other} size={44} />
              {other?.is_online && (
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
              {lastTextRaw}
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
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-1 rounded-md transition-opacity"
                  style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.10)" }}
                  data-testid={`chat-row-menu-trigger-${testIdSlug}`}
                  aria-label={t("actions")}
                  onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
                >
                  <MoreHorizontal className="w-3.5 h-3.5 text-white/80" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="min-w-[180px]"
                style={{ background: "rgba(11,11,18,0.92)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.10)" }}
                data-testid={`chat-row-menu-${testIdSlug}`}
              >
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await setPinned(c.id, !c.is_pinned);
                      setPinErr("");
                    } catch (err) {
                      setPinErr(err?.response?.data?.detail || err.message);
                    }
                  }}
                  data-testid={`chat-row-action-pin-${testIdSlug}`}
                >
                  {c.is_pinned ? (
                    <><PinOff className="w-4 h-4 mr-2" /> {t("unpin")}</>
                  ) : (
                    <><Pin className="w-4 h-4 mr-2" /> {t("pinToTop")}</>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMuted(c.id, !c.is_muted)}
                  data-testid={`chat-row-action-mute-${testIdSlug}`}
                >
                  {c.is_muted ? (
                    <><Bell className="w-4 h-4 mr-2" /> {t("unmute")}</>
                  ) : (
                    <><BellOff className="w-4 h-4 mr-2" /> {t("muteNotifications")}</>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => markRead(c.id)}
                  data-testid={`chat-row-action-read-${testIdSlug}`}
                >
                  <CheckCheck className="w-4 h-4 mr-2" /> {t("markAsRead")}
                </DropdownMenuItem>
                {pinErr && (
                  <div className="px-2 py-1 text-[10px] text-red-300" data-testid={`chat-row-pin-error-${testIdSlug}`}>
                    {pinErr}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </motion.button>
    );
  },
  (prev, next) => {
    if (prev.isActive !== next.isActive) return false;
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
  const { setActiveConv, setPinned, setMuted, markRead } = useMessengerActions();

  if (!conversations || conversations.length === 0) {
    return (
      <div className="text-center text-xs text-[var(--gm-text-muted)] mt-6 px-4" data-testid="chat-list-empty">
        {t("noConversations")}
      </div>
    );
  }

  return (
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
        />
      ))}
    </div>
  );
};
