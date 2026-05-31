import React from "react";
import { useMessengerActions } from "../../lib/messenger";
import { useAuth } from "../../lib/auth";

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export const QuickReactionRow = ({ messageId, convId, onPicked }) => {
  const { toggleReaction } = useMessengerActions();
  return (
    <div className="flex items-center gap-1 px-1 py-1" data-testid="quick-reactions-row">
      {QUICK_EMOJIS.map((e) => (
        <button
          key={e}
          onClick={async () => {
            try { await toggleReaction(messageId, e, convId); } catch { /* ignore */ }
            onPicked?.();
          }}
          className="text-lg leading-none p-1 rounded-md hover:bg-white/10 hover:scale-110 transition-transform"
          data-testid={`quick-reaction-${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
};

export const ReactionChips = ({ message, convId }) => {
  const { user } = useAuth();
  const { toggleReaction } = useMessengerActions();
  const reactions = message?.reactions || [];
  if (reactions.length === 0) return null;
  // Group by emoji
  const groups = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, mine: false };
    groups[r.emoji].count += 1;
    if (r.user_id === user?.id) groups[r.emoji].mine = true;
  }
  const entries = Object.entries(groups);
  return (
    <div className="flex flex-wrap gap-1 mt-1" data-testid={`reactions-chips-${message.id}`}>
      {entries.map(([emoji, info]) => (
        <button
          key={emoji}
          onClick={(e) => {
            // Phase 26 Bug 6 — never bubble; tap on a reaction must NOT open the bubble context menu.
            e.stopPropagation();
            e.preventDefault();
            toggleReaction(message.id, emoji, convId).catch(() => {});
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="text-[11px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full transition-transform hover:scale-105"
          style={
            info.mine
              ? { background: "rgba(59,158,255,0.22)", border: "1px solid rgba(59,158,255,0.55)" }
              : { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)" }
          }
          data-testid={`reaction-chip-${message.id}-${emoji}`}
        >
          <span>{emoji}</span>
          <span className="text-[10px] opacity-80">{info.count}</span>
        </button>
      ))}
    </div>
  );
};
