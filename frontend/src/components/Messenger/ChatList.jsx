import React from "react";
import { motion } from "framer-motion";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessenger } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { listTime } from "../../lib/time";

export const ChatList = () => {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { conversations, activeConvId, setActiveConv, typingByConv } = useMessenger();

  const formatPreview = (lm) => {
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

  if (!conversations || conversations.length === 0) {
    return (
      <div className="text-center text-xs text-[var(--gm-text-muted)] mt-6 px-4" data-testid="chat-list-empty">
        {t("noConversations")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="chat-list">
      {conversations.map((c) => {
        const other = c.other_user;
        const isActive = c.id === activeConvId;
        const lastMsg = c.last_message;
        const typing =
          other && (typingByConv[c.id] || {})[other.id];
        const lastTextRaw = typing
          ? t("typing")
          : lastMsg
          ? `${lastMsg.sender_id === user?.id ? `${t("you")}: ` : ""}${formatPreview(lastMsg)}`
          : t("newConversation");
        return (
          <motion.button
            key={c.id}
            whileTap={{ scale: 0.99 }}
            onClick={() => setActiveConv(c.id)}
            className={`text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-colors`}
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
            data-testid={`chat-list-item-${other?.username || c.id}`}
          >
            <div className="relative shrink-0">
              <UserAvatar user={other} size={44} />
              {other?.is_online && (
                <span className="absolute -bottom-0.5 right-0">
                  <OnlineDot online size={11} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-white font-medium text-sm truncate">
                  {other?.display_name || other?.username || "Unknown"}
                </div>
                <div className="text-[10px] text-[var(--gm-text-muted)] shrink-0">
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
                    style={{
                      background:
                        "linear-gradient(135deg,#3B9EFF,#A78BFA)",
                      boxShadow: "0 6px 14px -6px rgba(59,158,255,0.5)",
                    }}
                    data-testid={`unread-badge-${other?.username || c.id}`}
                  >
                    {c.unread_count}
                  </span>
                )}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
};
