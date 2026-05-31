import React, { memo, useState } from "react";
import { motion } from "framer-motion";
import {
  MoreHorizontal,
  Reply,
  Forward,
  Copy,
  Pencil,
  Trash2,
  CornerUpLeft,
  Pin,
  PinOff,
  Eye,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../ui/dropdown-menu";
import { Ticks } from "./Ticks";
import { MediaContent } from "./MediaContent";
import { QuickReactionRow, ReactionChips } from "./Reactions";
import { formatTime } from "../../lib/time";
import { isEmojiOnly } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { useLongPress } from "../../lib/useLongPress";
import { parseMentions } from "../../lib/parseMentions";
import { useUserProfile } from "./UserProfileDrawer";
import { usePublicChatPreview } from "./PublicChatPreviewDrawer";
import { useMessengerActions } from "../../lib/messenger";
import { useAuth } from "../../lib/auth";
import { formatCount } from "../../lib/formatNumber";
import { UserAvatar } from "../Avatar";
import { api } from "../../lib/api";
import { toast } from "sonner";

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const DELETE_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;

const HUE_PALETTE = ['#7dd3fc','#c4b5fd','#fda4af','#bef264','#fcd34d','#f9a8d4','#a5f3fc','#86efac'];
const senderColor = (id) => {
  let h = 0;
  for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUE_PALETTE[h % HUE_PALETTE.length];
};

const ReplyQuote = ({ replyTo, mine, onClick }) => {
  if (!replyTo) return null;
  return (
    <button
      onClick={onClick}
      className="text-left w-full mb-1.5 px-2.5 py-1.5 rounded-lg flex gap-2 items-stretch"
      style={{
        background: mine ? "rgba(255,255,255,0.10)" : "rgba(59,158,255,0.10)",
        border: `1px solid ${mine ? "rgba(255,255,255,0.16)" : "rgba(59,158,255,0.28)"}`,
      }}
      data-testid="message-reply-quote"
    >
      <span
        className="w-[3px] rounded-full shrink-0"
        style={{ background: mine ? "rgba(255,255,255,0.7)" : "#3B9EFF" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-wider opacity-70">
          <CornerUpLeft className="inline w-2.5 h-2.5 mr-1" />
          {replyTo.type === "text" ? "" : `[${replyTo.type}] `}
        </span>
        <span className="block text-xs truncate" style={{ unicodeBidi: "plaintext" }}>
          {replyTo.text_preview || replyTo.file_name || "…"}
        </span>
      </span>
    </button>
  );
};

const ForwardedHeader = ({ from, t }) => {
  if (!from) return null;
  const name = from.original_sender_display_name || from.original_sender_username || "—";
  return (
    <div
      className="text-[10px] italic mb-1"
      style={{ color: "#C9B8FF" }}
      data-testid="message-forwarded-header"
    >
      {t("forwardedFrom")} {name}
    </div>
  );
};

const MessageBubbleImpl = ({
  message,
  mine,
  showAvatar,
  conversation,
  groupMembers,
  onOpenImage,
  testId,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onJumpToReply,
  selectionMode,
  isSelected,
  onToggleSelect,
  onEnterSelection,
}) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const { openUserProfile } = useUserProfile();
  const { openPublicChat } = usePublicChatPreview();
  const { setActiveConv, openOrCreateConversation, pinMessage, unpinMessage, loadGroupMembers } = useMessengerActions();
  const { user: meUser } = useAuth();
  const currentUserId = meUser?.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteForAll, setDeleteForAll] = useState(false);
  const lp = useLongPress(() => {
    if (onEnterSelection) onEnterSelection(message);
    else setMenuOpen(true);
  }, { threshold: 500 });

  // Phase 9A: lazy-load group members if missing on render (group bubbles only)
  React.useEffect(() => {
    if (!mine && conversation?.kind === "group" && conversation?.id && (!groupMembers || !groupMembers[message.sender_id])) {
      loadGroupMembers?.(conversation.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, message.sender_id]);

  const handleMentionClick = async (seg) => {
    if (seg.type === "conv") {
      // /c/handle — always route through the preview drawer.
      openPublicChat(seg.name);
      return;
    }
    // @handle — try user first, fall back to public group/channel handle
    // so users can paste group/channel handles in messages and have them
    // resolve to the preview drawer instead of error-ing out.
    try {
      const { data } = await api.get(`/users/by-username/${seg.name}`);
      openUserProfile(data);
      return;
    } catch (e) {
      if (e?.response?.status !== 404) {
        toast.error(e?.response?.data?.detail || e.message || "Failed");
        return;
      }
    }
    try {
      await api.get(`/conversations/by-handle/${seg.name}`);
      openPublicChat(seg.name);
    } catch (e2) {
      if (e2?.response?.status === 404) {
        toast.error((t("userNotFound") || "@{username} not found").replace("{username}", seg.name).replace("{handle}", seg.name));
      } else {
        toast.error(e2?.response?.data?.detail || e2.message || "Failed");
      }
    }
  };

  const renderTextWithMentions = (text) => {
    const segs = parseMentions(text);
    return segs.map((seg, i) => {
      if (typeof seg === "string") return <React.Fragment key={i}>{seg}</React.Fragment>;
      return (
        <span
          key={i}
          className="gm-mention"
          onClick={(e) => { e.stopPropagation(); handleMentionClick(seg); }}
          data-testid={`mention-${seg.type}-${seg.name}`}
        >
          {seg.raw}
        </span>
      );
    });
  };

  // Phase 26 Bug 2 — fully hide deleted messages (no tombstone).
  if (message.deleted_for_everyone) return null;

  const created = new Date(message.created_at).getTime();
  const now = Date.now();
  const isText = (message.type || "text") === "text";
  const editable = mine && isText && now - created < EDIT_WINDOW_MS;
  const deletableAll = mine && now - created < DELETE_ALL_WINDOW_MS;
  const emojiOnly = isText && isEmojiOnly(message.text || "");
  const isPending = message.status === "pending" || message.status === "uploading";
  const isFailed = message.status === "failed";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group relative flex w-full ${mine ? "justify-end" : "justify-start"} px-2 ${conversation?.kind === "group" && !mine ? "ps-12" : ""}`}
      data-testid={testId || `message-${message.id}`}
    >
      {conversation?.kind === "group" && !mine && showAvatar && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const m = groupMembers?.[message.sender_id];
            openUserProfile(m || { id: message.sender_id });
          }}
          className="absolute bottom-0 start-2 rounded-full"
          aria-label="open profile"
          data-testid="group-sender-avatar"
        >
          <UserAvatar user={groupMembers?.[message.sender_id] || { id: message.sender_id }} size={32} />
        </button>
      )}
      <div
        {...lp}
        onClick={(e) => {
          e.stopPropagation();
          if (lp.didFire?.()) return;
          if (selectionMode) { onToggleSelect?.(message); return; }
          setMenuOpen(true);
        }}
        className={`relative max-w-[78%] md:max-w-[70%] lg:max-w-[60%] lg:max-w-[min(60%,560px)] rounded-2xl ${emojiOnly ? "px-1 py-0" : "px-3 py-2"} cursor-pointer ${isSelected ? "ring-2 ring-[#3B9EFF] ring-offset-2 ring-offset-transparent" : ""}`}
        data-testid={isSelected ? `message-selected-${message.id}` : undefined}
        style={
          emojiOnly
            ? { background: "transparent", WebkitTouchCallout: "none" }
            : mine
            ? {
                background: "var(--bubble-mine-bg)",
                boxShadow: "0 10px 30px -12px var(--accent-glow)",
                color: "var(--bubble-mine-text)",
                WebkitTouchCallout: "none",
              }
            : {
                background: "var(--bubble-theirs-bg)",
                border: "1px solid var(--border-glass)",
                color: "var(--bubble-theirs-text)",
                WebkitTouchCallout: "none",
              }
        }
      >
        {conversation?.kind === "group" && !mine && showAvatar && (
          <div
            className="text-[11px] font-semibold mb-1 cursor-pointer hover:underline"
            style={{ color: senderColor(message.sender_id) }}
            onClick={(e) => {
              e.stopPropagation();
              const m = groupMembers?.[message.sender_id];
              if (m) openUserProfile(m);
              else openUserProfile({ id: message.sender_id });
            }}
            data-testid="group-sender-label"
          >
            {groupMembers?.[message.sender_id]?.display_name ||
              groupMembers?.[message.sender_id]?.username ||
              `User ${String(message.sender_id).slice(0, 6)}`}
            {groupMembers?.[message.sender_id]?.admin_title && (
              <span
                className="ms-1 text-[9px] font-normal opacity-70"
                style={{ color: "#C9B8FF" }}
                data-testid="group-sender-admin-title"
              >
                [{groupMembers[message.sender_id].admin_title}]
              </span>
            )}
          </div>
        )}
        {message.forwarded_from && <ForwardedHeader from={message.forwarded_from} t={t} />}
        {message.reply_to && (
          <ReplyQuote
            replyTo={message.reply_to}
            mine={mine}
            onClick={() => onJumpToReply?.(message.reply_to.message_id)}
          />
        )}
        {message.type && message.type !== "text" && (
          <div className={message.text ? "mb-1" : ""}>
            <MediaContent message={message} onOpenImage={onOpenImage} />
          </div>
        )}
        {message.text && (
          <div
            className={`whitespace-pre-wrap break-words ${
              emojiOnly ? "text-5xl leading-tight" : "text-sm"
            }`}
            style={{ unicodeBidi: "plaintext" }}
            data-testid="message-text"
          >
            {emojiOnly ? message.text : renderTextWithMentions(message.text)}
          </div>
        )}
        <ReactionChips message={message} convId={message.conversation_id} />
        <div
          className={`flex items-center gap-1 text-[10px] mt-0.5 ${
            mine ? "justify-end" : "justify-start"
          }`}
          style={{ color: mine ? "rgba(255,255,255,0.78)" : "var(--text-muted)" }}
        >
          {message.edited && (
            <span data-testid="message-edited-marker">{t("edited")}</span>
          )}
          <span>{formatTime(message.created_at)}</span>
          {conversation?.kind === "channel" && (message.view_count || 0) > 0 && (
            <span className="flex items-center gap-0.5" data-testid="message-view-count">
              <Eye className="w-3 h-3" />
              <span>{formatCount(message.view_count)}</span>
            </span>
          )}
          {message.pinned_in_conv && (
            <Pin className="w-3 h-3" data-testid="message-pin-indicator" />
          )}
          {mine && !isPending && !isFailed && conversation?.kind !== "channel" && <Ticks status={message.status} />}
          {isPending && <span className="opacity-70">·</span>}
          {isFailed && <span className="text-red-300">!</span>}
        </div>
      </div>

      {/* Hover ⋯ action button (anchors the menu) */}
      {!isPending && !isFailed && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={`absolute top-1 ${mine ? "left-0 -translate-x-full" : "right-0 translate-x-full"} opacity-0 pointer-events-none p-0 w-0 h-0`}
              data-testid={`message-actions-trigger-${message.id}`}
              aria-hidden="true"
              tabIndex={-1}
              onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
            >
              <MoreHorizontal className="w-0 h-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[180px]"
            style={{ background: "var(--modal-bg)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.10)" }}
            data-testid={`message-actions-menu-${message.id}`}
          >
            <QuickReactionRow messageId={message.id} convId={message.conversation_id} onPicked={() => setMenuOpen(false)} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onReply?.(message)} data-testid="msg-action-reply">
              <Reply className="w-4 h-4 mr-2" /> {t("reply")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onForward?.(message)} data-testid="msg-action-forward">
              <Forward className="w-4 h-4 mr-2" /> {t("forward")}
            </DropdownMenuItem>
            {!message.deleted_for_everyone && (
              (() => {
                const isChannel = conversation?.kind === "channel";
                const isGroup = conversation?.kind === "group";
                const isAdmin = !!conversation?.admins?.includes?.(currentUserId);
                const canPin = isChannel || isGroup ? isAdmin : true;
                if (!canPin) return null;
                return message.pinned_in_conv ? (
                  <DropdownMenuItem
                    onClick={async () => {
                      try { await unpinMessage(message.id); } catch (e) { toast.error(e?.response?.data?.detail || t("pinFailed")); }
                    }}
                    data-testid="msg-action-unpin"
                  >
                    <PinOff className="w-4 h-4 mr-2" /> {t("unpinMessage")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={async () => {
                      try { await pinMessage(message.id); } catch (e) { toast.error(e?.response?.data?.detail || t("pinFailed")); }
                    }}
                    data-testid="msg-action-pin"
                  >
                    <Pin className="w-4 h-4 mr-2" /> {t("pinMessage")}
                  </DropdownMenuItem>
                );
              })()
            )}
            {isText && (
              <DropdownMenuItem
                onClick={() => navigator.clipboard?.writeText(message.text || "")}
                data-testid="msg-action-copy"
              >
                <Copy className="w-4 h-4 mr-2" /> {t("copyText")}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onClick={() => onEdit?.(message)} data-testid="msg-action-edit">
                <Pencil className="w-4 h-4 mr-2" /> {t("edit")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { setDeleteForAll(false); setConfirmDelete(true); }}
              data-testid="msg-action-delete"
            >
              <Trash2 className="w-4 h-4 mr-2 text-red-300" />
              <span className="text-red-300">{t("deleteMsg")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
        {confirmDelete && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
            data-testid="msg-delete-confirm-overlay"
          >
            <div
              className="rounded-2xl p-5 max-w-sm w-full"
              style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", backdropFilter: "blur(20px)" }}
              onClick={(e) => e.stopPropagation()}
              data-testid="msg-delete-confirm-dialog"
            >
              <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                {t("deleteMessageTitle") || "Delete message?"}
              </div>
              <div className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
                {t("areYouSure") || "Are you sure?"}
              </div>
              {deletableAll && (
                <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={deleteForAll}
                    onChange={(e) => setDeleteForAll(e.target.checked)}
                    data-testid="msg-delete-for-everyone-checkbox"
                  />
                  {t("deleteForEveryone")}
                </label>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: "var(--text-secondary)" }} data-testid="msg-delete-cancel">
                  {t("cancel")}
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); onDelete?.(message, deleteForAll ? "all" : "me"); }}
                  className="px-3 py-1.5 rounded-lg text-sm text-white"
                  style={{ background: "#E5484D" }}
                  data-testid="msg-delete-confirm"
                >
                  {t("deleteMsg")}
                </button>
              </div>
            </div>
          </div>
        )}
    </motion.div>
  );
};

const areEqual = (prev, next) => {
  if (prev.mine !== next.mine) return false;
  if (prev.showAvatar !== next.showAvatar) return false;
  if (prev.conversation?.kind !== next.conversation?.kind) return false;
  if (prev.groupMembers !== next.groupMembers) return false;
  if (prev.onOpenImage !== next.onOpenImage) return false;
  if (prev.onReply !== next.onReply) return false;
  if (prev.onForward !== next.onForward) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onDelete !== next.onDelete) return false;
  if (prev.onJumpToReply !== next.onJumpToReply) return false;
  if (prev.testId !== next.testId) return false;
  // Phase 9C — multi-select props must invalidate memo so click/long-press
  // closures capture the current selection state on every flip.
  if (prev.selectionMode !== next.selectionMode) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.onToggleSelect !== next.onToggleSelect) return false;
  if (prev.onEnterSelection !== next.onEnterSelection) return false;
  const a = prev.message, b = next.message;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.text === b.text &&
    a.type === b.type &&
    a.created_at === b.created_at &&
    a.seen_at === b.seen_at &&
    a.delivered_at === b.delivered_at &&
    a.media === b.media &&
    a.reply_to === b.reply_to &&
    a.forwarded_from === b.forwarded_from &&
    a.edited === b.edited &&
    a.edited_at === b.edited_at &&
    a.deleted_for_everyone === b.deleted_for_everyone &&
    a._progress === b._progress &&
    a._localUrl === b._localUrl &&
    a._error === b._error
  );
};

export const MessageBubble = memo(MessageBubbleImpl, areEqual);
