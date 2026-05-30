import React, { useEffect, useRef, useState } from "react";
import { SendHorizonal, Paperclip, Smile, Mic } from "lucide-react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { useI18n } from "../../lib/i18n";
import { useMessenger } from "../../lib/messenger";
import { VoiceRecorder } from "./VoiceRecorder";
import { detectKind } from "../../lib/format";

const MAX_BYTES = 100 * 1024 * 1024;

export const Composer = ({ conversationId, onUploadError }) => {
  const { t, lang } = useI18n();
  const { sendMessage, sendTyping, uploadMedia } = useMessenger();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setText("");
    setShowEmoji(false);
    setRecording(false);
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
    } catch {
      /* swallow */
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

  const handleFile = async (file, opts = {}) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      onUploadError?.(t("fileTooLarge"));
      return;
    }
    try {
      await uploadMedia(conversationId, file, opts);
    } catch (e) {
      onUploadError?.(e?.response?.data?.detail || t("uploadFailed"));
    }
  };

  const onFileInput = async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleFile(f, { kind: detectKind(f) });
    if (fileRef.current) fileRef.current.value = "";
  };

  const insertEmoji = (emoji) => {
    const ta = taRef.current;
    if (!ta) {
      setText((p) => p + emoji);
      return;
    }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  if (recording) {
    return (
      <div
        className="border-t border-white/10 p-3 sm:p-4"
        style={{ background: "rgba(11,11,18,0.6)", backdropFilter: "blur(20px)" }}
        data-testid="composer-recording"
      >
        <VoiceRecorder
          onSend={(file, opts) => {
            setRecording(false);
            handleFile(file, { kind: "voice", ...opts });
          }}
          onCancel={() => setRecording(false)}
        />
      </div>
    );
  }

  return (
    <div
      className="relative border-t border-white/10 p-3 sm:p-4"
      style={{ background: "rgba(11,11,18,0.6)", backdropFilter: "blur(20px)" }}
      data-testid="composer"
    >
      {showEmoji && (
        <div
          className="absolute bottom-full mb-3 left-3 z-30"
          onMouseLeave={() => setShowEmoji(false)}
          data-testid="emoji-picker-popover"
        >
          <EmojiPicker
            theme={Theme.DARK}
            onEmojiClick={(d) => {
              insertEmoji(d.emoji);
            }}
            searchPlaceHolder={t("searchEmoji")}
            lazyLoadEmojis
            width={320}
            height={380}
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}
      <div
        className="flex items-end gap-1 rounded-2xl p-1.5"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="attach"
          data-testid="composer-attach-button"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={onFileInput}
          data-testid="composer-file-input"
        />
        <button
          type="button"
          onClick={() => setShowEmoji((v) => !v)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="emoji"
          data-testid="composer-emoji-button"
        >
          <Smile className="w-5 h-5" />
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("typeMessage")}
          className="flex-1 bg-transparent outline-none resize-none text-white placeholder-white/40 px-2 py-2 max-h-40"
          style={{ unicodeBidi: "plaintext", direction: lang === "fa" ? "rtl" : "ltr" }}
          data-testid="composer-input"
        />
        {text.trim() ? (
          <button
            onClick={submit}
            disabled={sending}
            className="gm-btn-primary"
            style={{ padding: "10px 14px", borderRadius: 14 }}
            aria-label="send"
            data-testid="composer-send-button"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRecording(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
            aria-label="record voice"
            data-testid="composer-voice-button"
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
