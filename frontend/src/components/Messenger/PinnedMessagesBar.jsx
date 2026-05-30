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

  const handleClick = useCallback(() => {
    if (!pinned.length) return;
    onJump?.(pinned[0].id);
  }, [pinned, onJump]);

  if (!pinned.length) return null;
  const top = pinned[0];
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
          {t("pinnedMessages")}{pinned.length > 1 ? ` · ${pinned.length}` : ""}
        </div>
        <div className="text-xs truncate" style={{ color: "var(--text-secondary)" }} data-testid="pinned-top-preview">
          {preview}
        </div>
      </div>
    </div>
  );
};

export default PinnedMessagesBar;
