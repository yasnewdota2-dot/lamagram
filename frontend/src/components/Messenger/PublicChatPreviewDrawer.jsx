import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Copy, Check, Megaphone, Users, MessageCircle } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { GroupAvatar } from "./GroupAvatar";
import { formatCount } from "../../lib/formatNumber";
import { useIsMobile } from "../../lib/useIsMobile";
import { toast } from "sonner";

const Ctx = createContext({ openPublicChat: () => {} });
export const usePublicChatPreview = () => useContext(Ctx);

export const PublicChatPreviewProvider = ({ children }) => {
  const [handle, setHandle] = useState(null);
  const open = useCallback((h) => setHandle(typeof h === "string" ? h : null), []);
  const close = useCallback(() => setHandle(null), []);
  return (
    <Ctx.Provider value={{ openPublicChat: open, closePublicChat: close }}>
      {children}
      <AnimatePresence>
        {handle && <PreviewDrawer key={`pc-${handle}`} handle={handle} onClose={close} />}
      </AnimatePresence>
    </Ctx.Provider>
  );
};

const PreviewDrawer = ({ handle, onClose }) => {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { setActiveConv, joinConversation } = useMessengerActions();
  const [conv, setConv] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Phase 10 — errors should self-clear after 5s
  useEffect(() => {
    if (!err) return undefined;
    const id = setTimeout(() => setErr(""), 5000);
    return () => clearTimeout(id);
  }, [err]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr("");
    api.get(`/conversations/by-handle/${handle}`)
      .then((r) => { if (!cancelled) setConv(r.data); })
      .catch((e) => {
        if (cancelled) return;
        if (e?.response?.status === 404) {
          toast.error(t("channelNotFound").replace("{handle}", handle));
          onClose();
        } else {
          setErr(e?.response?.data?.detail || "Failed to load");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [handle, onClose, t]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isChannel = conv?.kind === "channel";
  const isMember = !!conv?.is_member;
  // /api/conversations/by-handle returns flat fields (title, avatar_url,
  // member_count, description), not a nested `group` object. Build a virtual
  // `g` so the GroupAvatar API still gets a {title, avatar_url} shape.
  const g = conv
    ? {
        title: conv.title,
        avatar_url: conv.avatar_url,
        description: conv.description,
        member_count: conv.member_count,
      }
    : {};

  const copyHandle = async () => {
    try { await navigator.clipboard.writeText(`@${conv.handle}`); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };

  const doPrimary = async () => {
    if (!conv) return;
    setBusy(true);
    try {
      if (isMember) {
        setActiveConv(conv.id); onClose();
      } else {
        await joinConversation({ handle: conv.handle });
        setActiveConv(conv.id);
        onClose();
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Join failed");
    } finally { setBusy(false); }
  };

  const panelInit = isMobile ? { y: "100%", opacity: 0.7 } : { x: 320, opacity: 0 };
  const panelAnim = isMobile ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 };
  const panelExit = isMobile ? { y: "100%", opacity: 0 } : { x: 320, opacity: 0 };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
        className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={isMobile ? undefined : onClose} data-testid="public-chat-backdrop" />
      <motion.div initial={panelInit} animate={panelAnim} exit={panelExit} transition={{ duration: 0.24, ease: "easeOut" }}
        className={isMobile ? "fixed inset-x-0 bottom-0 top-12 z-50 rounded-t-3xl" : "fixed right-0 top-0 bottom-0 z-50 w-[360px] max-w-[92vw]"}
        style={{ background: "var(--bg-glass-strong)", borderLeft: isMobile ? "none" : "1px solid var(--border-glass)", borderTop: isMobile ? "1px solid var(--border-glass)" : "none", backdropFilter: "blur(24px) saturate(140%)", boxShadow: isMobile ? "0 -8px 32px rgba(0,0,0,0.35)" : "-8px 0 32px rgba(0,0,0,0.35)" }}
        data-testid="public-chat-preview-drawer" role="dialog" aria-modal="true">
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-glass)" }}>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{isChannel ? t("channel") || "Channel" : t("group") || "Group"}</div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10" aria-label="close" data-testid="public-chat-close">
              <X className="w-4 h-4" style={{ color: "var(--text-primary)" }} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-6">
            {loading && <div className="text-center text-sm py-10" style={{ color: "var(--text-muted)" }}>{t("loading")}</div>}
            {!loading && err && <div className="text-center text-sm py-10" style={{ color: "#E5484D" }}>{err}</div>}
            {conv && (
              <>
                <div className="flex flex-col items-center text-center">
                  <GroupAvatar group={{ title: g.title, avatar_url: g.avatar_url }} size={isMobile ? 120 : 96} />
                  <div className="mt-4 text-xl font-bold" style={{ color: "var(--text-primary)" }} data-testid="public-chat-title">{g.title}</div>
                  <button onClick={copyHandle} className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }} data-testid="public-chat-handle-copy">
                    <span>@{conv.handle}</span>
                    {copied ? <Check className="w-3.5 h-3.5" style={{ color: "#10B981" }} /> : <Copy className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />}
                  </button>
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase px-2 py-0.5 rounded-md"
                    style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "#C9B8FF" }}>
                    {isChannel ? <Megaphone className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                    {isChannel ? t("channelBadge") || "CHANNEL" : t("groupBadge")}
                  </div>
                  <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }} data-testid="public-chat-count">
                    {formatCount(g.member_count || 0)} {isChannel ? (t("subscribers") || "subscribers") : (t("members") || "members")}
                  </div>
                  {g.description && (
                    <div className="mt-4 text-sm leading-relaxed max-w-[280px]" style={{ color: "var(--text-secondary)" }} data-testid="public-chat-desc">
                      {g.description}
                    </div>
                  )}
                </div>
                <div className="mt-6 flex flex-col gap-2">
                  <button onClick={doPrimary} disabled={busy}
                    className="h-12 rounded-2xl flex items-center justify-center gap-2 text-white text-sm font-semibold disabled:opacity-60"
                    style={{ background: "var(--accent-gradient)", boxShadow: "0 8px 24px -10px var(--accent-glow)" }}
                    data-testid="public-chat-primary-action">
                    <MessageCircle className="w-4 h-4" />
                    {isMember ? (t("openConversation") || "Open") : (isChannel ? (t("joinThisChannel") || "Join channel") : (t("joinThisGroup") || "Join group"))}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default PublicChatPreviewProvider;
