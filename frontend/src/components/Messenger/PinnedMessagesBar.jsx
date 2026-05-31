import React, { useEffect, useState, useCallback } from "react";
import { Pin } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";

// Slim sticky strip above the message thread, showing the most recently
// pinned message. Click → jump to that message. Auto-refreshes on the
// `message_pinned`/`message_unpinned` WS events (which patch local state).
export const PinnedMessagesBar = ({ conversationId, messages, onJump }) => {
  const { t } = useI18n();
  const { listPinned } = useMessengerActions();
  const [pinned, setPinned] = useState([]);
  const [cursor, setCursor] = useState(0);

  // Initial fetch on conv change
  useEffect(() => {
    let cancelled = false;
    if (!conversationId) { setPinned([]); return; }
    listPinned(conversationId)
      .then((data) => { if (!cancelled) setPinned(data || []); })
      .catch(() => { if (!cancelled) setPinned([]); });
    return () => { cancelled = true; };
  }, [conversationId, listPinned]);

  // Re-derive pinned set when local messages mutate the pinned_in_conv flag
  // (covers WS pin/unpin without an extra HTTP fetch).
  useEffect(() => {
    if (!Array.isArray(messages)) return;
    const pinnedNow = messages.filter((m) => m.pinned_in_conv);
    setPinned((prev) => {
      // Only resync if the set of pinned IDs differs (newest first ordering).
      const prevIds = (prev || []).map((m) => m.id).sort().join("|");
      const nextIds = pinnedNow.map((m) => m.id).sort().join("|");
      if (prevIds === nextIds && prev.length === pinnedNow.length) return prev;
      // newest first: sort by created_at desc
      return [...pinnedNow].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    });
  }, [messages]);

  // Phase 25b — reset cursor if pinned set shrinks below current index
  useEffect(() => {
    if (pinned.length > 0 && cursor >= pinned.length) setCursor(0);
  }, [pinned.length, cursor]);

  const handleClick = useCallback(() => {
    if (!pinned.length) return;
    const idx = cursor % pinned.length;
    onJump?.(pinned[idx].id);
    // Phase 25b — cycle to next pinned message on each tap
    setCursor((c) => (c + 1) % pinned.length);
  }, [pinned, onJump, cursor]);

  if (!pinned.length) return null;
  const safeIdx = cursor % pinned.length;
  const top = pinned[safeIdx];
  const preview = (top.text && top.text.trim())
    || (top.type === "image" ? "📷 Photo" : top.type === "video" ? "🎬 Video" : top.type === "voice" ? "🎤 Voice" : top.type === "file" ? "📎 File" : "");

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 cursor-pointer"
      style={{
        background: "var(--bg-glass)",
        borderBottom: "1px solid var(--border-glass)",
        backdropFilter: "blur(12px)",
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      data-testid="pinned-messages-bar"
    >
      <Pin
        className="w-4 h-4 shrink-0"
        style={{ color: "var(--accent-blue, #3B9EFF)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold" style={{ color: "var(--accent-blue, #3B9EFF)" }}>
          {t("pinnedMessages")}{pinned.length > 1 ? ` · ${safeIdx + 1}/${pinned.length}` : ""}
        </div>
        <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }} data-testid="pinned-top-preview">
          {preview}
        </div>
      </div>
    </div>
  );
};

export default PinnedMessagesBar;
