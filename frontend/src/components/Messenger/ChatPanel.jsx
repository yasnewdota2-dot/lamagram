import React, { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessenger } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { TypingDots } from "./TypingDots";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { formatRelative } from "../../lib/time";
import { isWithinMinutes } from "../../lib/time";
import { MessageSquareText } from "lucide-react";

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
  const { messagesByConv, typingByConv, presence } = useMessenger();
  const scrollRef = useRef(null);

  const convId = conversation?.id;
  const messages = useMemo(
    () => (convId ? messagesByConv[convId] || [] : []),
    [convId, messagesByConv]
  );

  const other = conversation?.other_user;
  const livePres = other ? presence[other.id] : null;
  const isOnline = livePres ? livePres.is_online : !!other?.is_online;
  const lastSeen = livePres?.last_seen || other?.last_seen;

  const typingMap = (convId && typingByConv[convId]) || {};
  const otherTyping = !!(other && typingMap[other.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, convId, otherTyping]);

  if (!conversation) return <EmptyState />;

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-white/10"
        style={{ background: "rgba(11,11,18,0.55)", backdropFilter: "blur(16px)" }}
        data-testid="chat-header"
      >
        <div className="relative">
          <UserAvatar user={other} size={42} testId="chat-header-avatar" />
          <span className="absolute -bottom-0.5 right-0">
            <OnlineDot online={isOnline} size={11} testId="chat-header-online-dot" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold truncate" data-testid="chat-header-name">
            {other?.display_name || other?.username}
          </div>
          <div className="text-xs text-[var(--gm-text-muted)] truncate" data-testid="chat-header-presence">
            {otherTyping ? (
              <span className="text-[#9ABEFF] flex items-center gap-2">
                <TypingDots />
                {t("typing")}
              </span>
            ) : isOnline ? (
              <span>{t("online")}</span>
            ) : lastSeen ? (
              <span>
                {t("lastSeen")} {formatRelative(lastSeen, lang)}
              </span>
            ) : (
              <span>{t("offline")}</span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-4"
        data-testid="messages-scroll"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {messages.length === 0 ? (
            <div className="text-center text-sm text-[var(--gm-text-muted)] py-12">
              {t("noMessagesYet")}
            </div>
          ) : (
            messages.map((m, i) => {
              const mine = m.sender_id === user?.id;
              const prev = messages[i - 1];
              const showAvatar =
                !prev ||
                prev.sender_id !== m.sender_id ||
                !isWithinMinutes(prev.created_at, m.created_at, 2);
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  mine={mine}
                  showAvatar={showAvatar}
                  testId={`message-${m.id}`}
                />
              );
            })
          )}
        </motion.div>
      </div>

      {/* Composer */}
      <Composer conversationId={convId} />
    </div>
  );
};
