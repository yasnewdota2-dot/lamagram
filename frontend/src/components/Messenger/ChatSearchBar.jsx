import React, { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";

export const ChatSearchBar = ({ open, onClose, conversationId, onJump }) => {
  const { t, dir } = useI18n();
  const { searchInConversation } = useMessengerActions();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]); // newest-first array of messages
  const [idx, setIdx] = useState(0);
  const tmr = useRef(null);

  useEffect(() => {
    if (!open) { setQ(""); setMatches([]); setIdx(0); }
  }, [open]);

  useEffect(() => {
    if (tmr.current) clearTimeout(tmr.current);
    if (!q.trim() || !conversationId) { setMatches([]); setIdx(0); return; }
    tmr.current = setTimeout(async () => {
      try {
        const r = await searchInConversation(conversationId, q);
        setMatches(r || []);
        setIdx(0);
        if (r && r[0]) onJump?.(r[0].id, q);
      } catch { setMatches([]); }
    }, 250);
    return () => tmr.current && clearTimeout(tmr.current);
  }, [q, conversationId, searchInConversation, onJump]);

  const go = (delta) => {
    if (matches.length === 0) return;
    const ni = (idx + delta + matches.length) % matches.length;
    setIdx(ni);
    onJump?.(matches[ni].id, q);
  };

  if (!open) return null;
  return (
    <div
      dir={dir}
      className="flex items-center gap-2 px-3 py-2 border-b border-white/10"
      style={{ background: "rgba(11,11,18,0.7)", backdropFilter: "blur(18px)" }}
      data-testid="chat-search-bar"
    >
      <Search className="w-4 h-4 text-white/55" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchMessages")}
        className="bg-transparent outline-none flex-1 text-sm placeholder:text-white/40"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        data-testid="chat-search-input"
      />
      <span className="text-[10px] text-white/55 px-1" data-testid="chat-search-counter">
        {matches.length === 0 ? (q ? t("noResults") : "") : t("nMatches").replace("{cur}", String(idx + 1)).replace("{total}", String(matches.length))}
      </span>
      <button onClick={() => go(-1)} className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30" disabled={matches.length === 0} data-testid="chat-search-prev">
        <ChevronUp className="w-3.5 h-3.5 text-white/70" />
      </button>
      <button onClick={() => go(1)} className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30" disabled={matches.length === 0} data-testid="chat-search-next">
        <ChevronDown className="w-3.5 h-3.5 text-white/70" />
      </button>
      <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10" data-testid="chat-search-close">
        <X className="w-3.5 h-3.5 text-white/70" />
      </button>
    </div>
  );
};
