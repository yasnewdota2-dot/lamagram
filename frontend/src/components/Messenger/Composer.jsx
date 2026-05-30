import React, { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessenger } from "../../lib/messenger";

export const Composer = ({ conversationId }) => {
  const { t } = useI18n();
  const { sendMessage, sendTyping } = useMessenger();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    setText("");
    isTypingRef.current = false;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [conversationId]);

  const ping = (next) => {
    if (next && !isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(conversationId, true);
    }
    if (!next && isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(conversationId, false);
    }
  };

  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    if (v.trim().length === 0) {
      ping(false);
      return;
    }
    ping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => ping(false), 2000);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendMessage(conversationId, trimmed);
      setText("");
      ping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (taRef.current) taRef.current.focus();
    } catch (e) {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="border-t border-white/10 p-3 sm:p-4"
      style={{ background: "rgba(11,11,18,0.6)", backdropFilter: "blur(20px)" }}
      data-testid="composer"
    >
      <div
        className="flex items-end gap-2 rounded-2xl p-2"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("typeMessage")}
          className="flex-1 bg-transparent outline-none resize-none text-white placeholder-white/40 px-3 py-2 max-h-40"
          style={{ unicodeBidi: "plaintext" }}
          data-testid="composer-input"
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="gm-btn-primary"
          style={{ padding: "10px 14px", borderRadius: 14 }}
          aria-label="send"
          data-testid="composer-send-button"
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
