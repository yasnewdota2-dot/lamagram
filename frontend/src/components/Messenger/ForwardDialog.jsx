import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import {
  useConversations,
  useMessengerActions,
} from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { SavedAvatar } from "./ChatList";

const MAX_TARGETS = 10;

export const ForwardDialog = ({ open, onOpenChange, sourceMessage, sourceMessages, onDone }) => {
  const { t, dir } = useI18n();
  const { user } = useAuth();
  const conversations = useConversations();
  const { forwardMessages, searchUsers, openOrCreateConversation } = useMessengerActions();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const debTimer = useRef(null);

  // Resolve the set of source message ids: prefer the multi-source array,
  // otherwise fall back to the single-message API for back-compat.
  const sourceIds = useMemo(() => {
    if (Array.isArray(sourceMessages) && sourceMessages.length > 0) {
      return sourceMessages.map((m) => m.id);
    }
    if (sourceMessage?.id) return [sourceMessage.id];
    return [];
  }, [sourceMessage, sourceMessages]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchResults([]);
      setSelectedIds(new Set());
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (debTimer.current) clearTimeout(debTimer.current);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    debTimer.current = setTimeout(async () => {
      try {
        const res = await searchUsers(query);
        setSearchResults((res || []).filter((u) => u.id !== user?.id));
      } catch {
        setSearchResults([]);
      }
    }, 250);
    return () => debTimer.current && clearTimeout(debTimer.current);
  }, [query, searchUsers, user?.id]);

  const filteredConvs = useMemo(() => {
    if (!query.trim()) return conversations;
    const q = query.trim().toLowerCase().replace(/^@+/, "");
    return conversations.filter((c) => {
      if (c.kind === "saved") return t("savedMessages").toLowerCase().includes(q);
      const o = c.other_user;
      if (!o) return false;
      return (
        (o.username || "").toLowerCase().includes(q) ||
        (o.display_name || "").toLowerCase().includes(q)
      );
    });
  }, [conversations, query, t]);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_TARGETS) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (sourceIds.length === 0 || selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      // For any selected entry that's a user-id (from search), open or create the conversation first
      const targetConvIds = [];
      for (const id of selectedIds) {
        // ids prefixed with "user:" are user-ids that need conversation resolution
        if (id.startsWith("user:")) {
          const uid = id.slice(5);
          const conv = await openOrCreateConversation(uid);
          targetConvIds.push(conv.id);
        } else {
          targetConvIds.push(id);
        }
      }
      // Loop per source message — preserves original message order in each target.
      let totalForwarded = 0;
      for (const mid of sourceIds) {
        try {
          const res = await forwardMessages(mid, targetConvIds);
          totalForwarded += res?.forwarded || targetConvIds.length;
        } catch { /* continue */ }
      }
      onDone?.(totalForwarded || sourceIds.length * targetConvIds.length);
      onOpenChange(false);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderConvRow = (c) => {
    const isSel = selectedIds.has(c.id);
    const isSaved = c.kind === "saved";
    const other = c.other_user;
    const label = isSaved ? t("savedMessages") : other?.display_name || other?.username || "—";
    return (
      <button
        key={c.id}
        onClick={() => toggle(c.id)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors"
        style={
          isSel
            ? { background: "rgba(59,158,255,0.14)", border: "1px solid rgba(59,158,255,0.35)" }
            : { background: "transparent", border: "1px solid transparent" }
        }
        data-testid={`forward-conv-row-${isSaved ? "saved" : other?.username || c.id}`}
      >
        {isSaved ? <SavedAvatar size={36} /> : <UserAvatar user={other} size={36} />}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">{label}</div>
          {!isSaved && other?.username && (
            <div className="text-[11px] text-white/55 truncate">@{other.username}</div>
          )}
        </div>
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={
            isSel
              ? { background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.16)" }
          }
        >
          {isSel && <Check className="w-3 h-3 text-white" />}
        </div>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 max-w-md w-full overflow-hidden"
        style={{
          background: "var(--modal-bg)",
          backdropFilter: "blur(22px)",
          border: "1px solid var(--border-glass)",
          color: "var(--text-primary)",
        }}
        dir={dir}
        data-testid="forward-dialog"
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <DialogTitle className="text-base font-semibold m-0">{t("forwardTo")}</DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-md hover:bg-white/10"
            aria-label={t("cancel")}
            data-testid="forward-dialog-close"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>
        <DialogDescription className="sr-only">
          {t("forwardSelectChats")}
        </DialogDescription>
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <Search className="w-4 h-4 text-white/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder2")}
              className="bg-transparent outline-none flex-1 text-sm placeholder:text-white/40"
              data-testid="forward-search-input"
              autoFocus
            />
          </div>
        </div>
        <div className="px-3 pb-3 max-h-[50vh] overflow-y-auto flex flex-col gap-1" data-testid="forward-list">
          <div className="text-[10px] uppercase tracking-wider text-white/45 px-2 mt-1 mb-1">
            {t("chatsTitle")}
          </div>
          {filteredConvs.length === 0 && (
            <div className="text-xs text-white/45 px-3 py-2" data-testid="forward-no-convs">
              {t("noConversations")}
            </div>
          )}
          {filteredConvs.map(renderConvRow)}
          {searchResults.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-white/45 px-2 mt-2 mb-1">
                {t("searchingUsernames")}
              </div>
              {searchResults.map((u) => {
                const id = `user:${u.id}`;
                const isSel = selectedIds.has(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left"
                    style={
                      isSel
                        ? { background: "rgba(59,158,255,0.14)", border: "1px solid rgba(59,158,255,0.35)" }
                        : { background: "transparent", border: "1px solid transparent" }
                    }
                    data-testid={`forward-user-row-${u.username}`}
                  >
                    <UserAvatar user={u} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{u.display_name || u.username}</div>
                      <div className="text-[11px] text-white/55 truncate">@{u.username}</div>
                    </div>
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={
                        isSel
                          ? { background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }
                          : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.16)" }
                      }
                    >
                      {isSel && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="px-5 py-3 flex items-center justify-between gap-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="text-xs text-white/60" data-testid="forward-selected-count">
            {selectedIds.size === 0
              ? t("noChatsSelected")
              : t("selectedCount").replace("{n}", String(selectedIds.size))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-white/75 hover:bg-white/5"
              data-testid="forward-cancel-button"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
              data-testid="forward-send-button"
            >
              {submitting ? t("loading") : t("send")}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-5 pb-3 text-xs text-red-300"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};
