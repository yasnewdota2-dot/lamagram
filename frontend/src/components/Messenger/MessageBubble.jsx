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
import { formatTime } from "../../lib/time";
import { isEmojiOnly } from "../../lib/format";
import { useI18n } from "../../lib/i18n";

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const DELETE_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  onOpenImage,
  testId,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onJumpToReply,
}) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  if (message.deleted_for_everyone) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex w-full ${mine ? "justify-end" : "justify-start"} px-2`}
        data-testid={testId || `message-tombstone-${message.id}`}
      >
        <div
          className="max-w-[70%] px-3 py-2 rounded-2xl text-xs italic"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {t("messageWasDeleted")}
        </div>
      </motion.div>
    );
  }

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
      className={`group relative flex w-full ${mine ? "justify-end" : "justify-start"} px-2`}
      data-testid={testId || `message-${message.id}`}
    >
      <div
        className={`max-w-[78%] rounded-2xl ${emojiOnly ? "px-1 py-0" : "px-3 py-2"}`}
        style={
          emojiOnly
            ? { background: "transparent" }
            : mine
            ? {
                background: "linear-gradient(135deg,#3B9EFF,#A78BFA)",
                boxShadow: "0 10px 30px -12px rgba(59,158,255,0.45)",
                color: "white",
              }
            : {
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "white",
              }
        }
      >
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
            {message.text}
          </div>
        )}
        <div
          className={`flex items-center gap-1 text-[10px] mt-0.5 ${
            mine ? "justify-end" : "justify-start"
          }`}
          style={{ color: mine ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.55)" }}
        >
          {message.edited && (
            <span data-testid="message-edited-marker">{t("edited")}</span>
          )}
          <span>{formatTime(message.created_at)}</span>
          {mine && !isPending && !isFailed && <Ticks status={message.status} />}
          {isPending && <span className="opacity-70">·</span>}
          {isFailed && <span className="text-red-300">!</span>}
        </div>
      </div>

      {/* Hover ⋯ action button (anchors the menu) */}
      {!isPending && !isFailed && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={`absolute top-1 ${mine ? "left-0 -translate-x-full" : "right-0 translate-x-full"} opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded-md`}
              style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)" }}
              data-testid={`message-actions-trigger-${message.id}`}
              aria-label={t("actions")}
              onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-white/85" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[180px]"
            style={{ background: "rgba(11,11,18,0.92)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.10)" }}
            data-testid={`message-actions-menu-${message.id}`}
          >
            <DropdownMenuItem onClick={() => onReply?.(message)} data-testid="msg-action-reply">
              <Reply className="w-4 h-4 mr-2" /> {t("reply")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onForward?.(message)} data-testid="msg-action-forward">
              <Forward className="w-4 h-4 mr-2" /> {t("forward")}
            </DropdownMenuItem>
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="msg-action-delete-trigger">
                <Trash2 className="w-4 h-4 mr-2 text-red-300" />
                <span className="text-red-300">{t("deleteMsg")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                style={{ background: "rgba(11,11,18,0.92)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.10)" }}
              >
                <DropdownMenuItem onClick={() => onDelete?.(message, "me")} data-testid="msg-action-delete-me">
                  {t("deleteForMe")}
                </DropdownMenuItem>
                {deletableAll && (
                  <DropdownMenuItem
                    onClick={() => onDelete?.(message, "all")}
                    data-testid="msg-action-delete-all"
                  >
                    <span className="text-red-300">{t("deleteForEveryone")}</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </motion.div>
  );
};

const areEqual = (prev, next) => {
  if (prev.mine !== next.mine) return false;
  if (prev.showAvatar !== next.showAvatar) return false;
  if (prev.onOpenImage !== next.onOpenImage) return false;
  if (prev.onReply !== next.onReply) return false;
  if (prev.onForward !== next.onForward) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onDelete !== next.onDelete) return false;
  if (prev.onJumpToReply !== next.onJumpToReply) return false;
  if (prev.testId !== next.testId) return false;
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
