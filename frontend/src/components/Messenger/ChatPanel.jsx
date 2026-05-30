import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, Upload, MessageSquareText } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessenger } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { TypingDots } from "./TypingDots";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { Lightbox } from "./Lightbox";
import { formatRelative, isWithinMinutes } from "../../lib/time";

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
  const { messagesByConv, typingByConv, presence, uploadMedia } = useMessenger();
  const scrollRef = useRef(null);
  const prevLenRef = useRef(0);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [pendingNew, setPendingNew] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState("");

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

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="chat-panel"
    >
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
              <span>{t("lastSeen")} {formatRelative(lastSeen, lang)}</span>
            ) : (
              <span>{t("offline")}</span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-4"
        data-testid="messages-scroll"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center" data-testid="empty-conversation">
            <div className="max-w-xs">
              <div className="text-5xl mb-3">👋</div>
              <div className="text-white text-lg font-semibold">
                {t("sayHi")} {other?.display_name || other?.username}
              </div>
              <div className="text-xs text-[var(--gm-text-muted)] mt-2">{t("sayHiSub")}</div>
            </div>
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
                onOpenImage={setLightboxSrc}
                testId={`message-${m.id}`}
              />
            );
          })
        )}
      </div>

      {/* Scroll-down pill */}
      {!autoScroll && pendingNew > 0 && (
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
      <Composer
        conversationId={convId}
        onUploadError={(msg) => {
          setToast(msg);
          setTimeout(() => setToast(""), 3000);
        }}
      />

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
    </div>
  );
};
