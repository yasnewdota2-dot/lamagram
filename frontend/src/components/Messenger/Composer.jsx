import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { SendHorizonal, Paperclip, Smile, Mic, X, CornerUpLeft, Pencil } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions, useComposerStateForConv } from "../../lib/messenger";
import { VoiceRecorder } from "./VoiceRecorder";
import { detectKind } from "../../lib/format";

const EmojiPickerLazy = lazy(() =>
  import("emoji-picker-react").then((m) => ({ default: m.default }))
);
// emoji-picker-react v4 exposes Theme enum on the module too; we
// reproduce the dark value to avoid pulling the whole module eagerly.
const EMOJI_DARK_THEME = "dark";

const MAX_BYTES = 100 * 1024 * 1024;

export const Composer = ({ conversationId, onUploadError }) => {
  const { t, lang } = useI18n();
  const { sendMessage, sendTyping, uploadMedia, editMessage, setReplyTarget, setEditTarget } = useMessengerActions();
  const composerState = useComposerStateForConv(conversationId);
  const replyTo = composerState.replyTo || null;
  const editTarget = composerState.editTarget || null;
  const isEditing = !!editTarget;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef(null);
  const sendLockRef = useRef(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setText("");
    setShowEmoji(false);
    setRecording(false);
    isTypingRef.current = false;
    sendLockRef.current = false;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [conversationId]);

  // When entering edit mode, prefill text + focus
  useEffect(() => {
    if (editTarget && (editTarget.type || "text") === "text") {
      setText(editTarget.text || "");
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [editTarget]);

  const ping = useCallback((next) => {
    if (next && !isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(conversationId, true);
    }
    if (!next && isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(conversationId, false);
    }
  }, [conversationId, sendTyping]);

  const onChange = useCallback((e) => {
    const v = e.target.value;
    setText(v);
    if (v.trim().length === 0) {
      ping(false);
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      return;
    }
    ping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => ping(false), 1500);
  }, [ping]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sendLockRef.current) return;
    sendLockRef.current = true;
    setSending(true);
    // For edit, keep text visible until save resolves
    if (!isEditing) setText("");
    ping(false);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    try {
      if (isEditing) {
        await editMessage(editTarget.id, trimmed);
        setEditTarget(conversationId, null);
        setText("");
      } else {
        const opts = {};
        if (replyTo) {
          opts.reply_to_message_id = replyTo.id;
          opts._optimisticReplySnapshot = {
            message_id: replyTo.id,
            sender_id: replyTo.sender_id,
            type: replyTo.type,
            text_preview: (replyTo.text || "").slice(0, 120),
            file_name: replyTo.media?.file_name,
          };
        }
        await sendMessage(conversationId, trimmed, opts);
        if (replyTo) setReplyTarget(conversationId, null);
      }
    } catch {
      /* swallow */
    } finally {
      setSending(false);
      sendLockRef.current = false;
      if (taRef.current) taRef.current.focus();
    }
  }, [text, sending, conversationId, ping, sendMessage, editMessage, isEditing, editTarget, replyTo, setEditTarget, setReplyTarget]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendLockRef.current) submit();
    }
  }, [submit]);

  const handleFile = useCallback(async (file, opts = {}) => {
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
  }, [conversationId, uploadMedia, onUploadError, t]);

  const onFileInput = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (f) await handleFile(f, { kind: detectKind(f) });
    if (fileRef.current) fileRef.current.value = "";
  }, [handleFile]);

  const insertEmoji = useCallback((emoji) => {
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
  }, [text]);

  if (recording) {
    return (
      <div
        className="border-t p-3 sm:p-4"
        style={{ background: "var(--bg-glass-strong)", borderColor: "var(--border-glass)", backdropFilter: "blur(20px)" }}
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
      className="relative border-t p-3 sm:p-4"
      style={{ background: "var(--bg-glass-strong)", borderColor: "var(--border-glass)", backdropFilter: "blur(20px)" }}
      data-testid="composer"
    >
      {(replyTo || editTarget) && (
        <div
          className="mx-1 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-xl"
          style={{ background: "rgba(59,158,255,0.07)", border: "1px solid rgba(59,158,255,0.22)" }}
          data-testid={editTarget ? "composer-edit-strip" : "composer-reply-strip"}
        >
          {editTarget ? (
            <Pencil className="w-3.5 h-3.5 text-[#9ABEFF] shrink-0" />
          ) : (
            <CornerUpLeft className="w-3.5 h-3.5 text-[#9ABEFF] shrink-0" />
          )}
          <span className="w-[3px] self-stretch rounded-full" style={{ background: "#3B9EFF" }} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#9ABEFF]">
              {editTarget ? t("editing") : t("replyingTo")}
            </div>
            <div className="text-xs text-white truncate" style={{ unicodeBidi: "plaintext" }}>
              {(editTarget?.text || editTarget?.media?.file_name) ||
                (replyTo?.text || replyTo?.media?.file_name) ||
                "…"}
            </div>
          </div>
          <button
            onClick={() =>
              editTarget
                ? setEditTarget(conversationId, null)
                : setReplyTarget(conversationId, null)
            }
            className="p-1 rounded-md hover:bg-white/10"
            aria-label={t("cancel")}
            data-testid="composer-strip-cancel"
          >
            <X className="w-3.5 h-3.5 text-white/70" />
          </button>
        </div>
      )}
      {showEmoji && (
        <div
          className="absolute bottom-full mb-3 left-3 z-30"
          onMouseLeave={() => setShowEmoji(false)}
          data-testid="emoji-picker-popover"
        >
          <Suspense
            fallback={
              <div
                className="rounded-2xl px-4 py-3 text-xs text-white/60"
                style={{ width: 320, background: "rgba(11,11,18,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {t("loading")}
              </div>
            }
          >
            <EmojiPickerLazy
              theme={EMOJI_DARK_THEME}
              onEmojiClick={(d) => {
                insertEmoji(d.emoji);
              }}
              searchPlaceHolder={t("searchEmoji")}
              lazyLoadEmojis
              width={320}
              height={380}
              previewConfig={{ showPreview: false }}
            />
          </Suspense>
        </div>
      )}
      <div
        className="flex items-end gap-1 rounded-2xl p-1.5"
        style={{ background: "var(--bg-glass)", border: "1px solid var(--border-glass)" }}
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
          className="flex-1 bg-transparent outline-none resize-none placeholder-white/40 px-2 py-2 max-h-40"
          style={{ unicodeBidi: "plaintext", direction: lang === "fa" ? "rtl" : "ltr", color: "var(--text-primary)" }}
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
