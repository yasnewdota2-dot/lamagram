import React, { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Users as UsersIcon, Loader2, X, LinkIcon, Search, Compass } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { api } from "../../lib/api";
import { GroupAvatar } from "./GroupAvatar";
import { EmptyState } from "../EmptyState";

// Extract token from a pasted URL or raw string.
const extractToken = (raw) => {
  const s = (raw || "").trim();
  if (!s) return "";
  const idx = s.lastIndexOf("/join/");
  if (idx === -1) return s;
  let tail = s.slice(idx + "/join/".length);
  // strip query / fragment / trailing slash
  tail = tail.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return tail;
};

const KindBadge = ({ kind, t }) => (
  <span
    className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0"
    style={{
      background: kind === "channel" ? "rgba(59,158,255,0.14)" : "rgba(167,139,250,0.14)",
      border: `1px solid ${kind === "channel" ? "rgba(59,158,255,0.32)" : "rgba(167,139,250,0.32)"}`,
      color: kind === "channel" ? "#9ABEFF" : "#C9B8FF",
    }}
    data-testid={`discover-kind-badge-${kind}`}
  >
    {kind === "channel" ? <Megaphone className="w-2.5 h-2.5" /> : <UsersIcon className="w-2.5 h-2.5" />}
    {t(kind === "channel" ? "channelBadge" : "groupBadge")}
  </span>
);

const ResultRow = ({ item, joining, errorMsg, onJoin, t }) => {
  const isChan = item.kind === "channel";
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      data-testid="discover-result-row"
    >
      <div className="shrink-0">
        <GroupAvatar group={{ title: item.title, avatar_url: item.avatar_url }} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-white text-sm font-medium truncate">{item.title}</div>
          <KindBadge kind={item.kind} t={t} />
        </div>
        <div className="text-[11px] text-[var(--gm-text-muted)] truncate">
          {item.handle ? <span className="text-white/50">@{item.handle}</span> : null}
          {item.description ? <span className="ml-1">· {item.description}</span> : null}
        </div>
        {errorMsg && (
          <div className="mt-1 text-[11px] text-red-300" data-testid="discover-row-error">
            {errorMsg}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="text-[10px] text-white/50">
          {item.member_count} {isChan ? t("subscribersCount").replace("{n}", "").trim() : t("membersCount").replace("{n}", "").trim()}
        </div>
        <button
          onClick={() => onJoin(item)}
          disabled={joining}
          className="px-3 py-1 rounded-xl text-xs text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 6px 16px -6px rgba(59,158,255,0.6)" }}
          data-testid="discover-join-button"
        >
          {joining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("joinButton")}
        </button>
      </div>
    </div>
  );
};

export const JoinDialog = ({ open, onOpenChange, onJoined }) => {
  const { t } = useI18n();
  const { joinConversation, setActiveConv } = useMessengerActions();
  const [tab, setTab] = useState("discover"); // 'discover' | 'paste'

  // Discover
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const debounceRef = useRef(null);

  // Paste
  const [pasted, setPasted] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  // Phase 10 — paste errors must self-clear so they don't persist after the user moves on.
  useEffect(() => {
    if (!pasteErr) return undefined;
    const id = setTimeout(() => setPasteErr(""), 5000);
    return () => clearTimeout(id);
  }, [pasteErr]);

  useEffect(() => {
    if (!open) {
      setTab("discover");
      setQ("");
      setResults([]);
      setLoading(false);
      setJoiningId(null);
      setRowErrors({});
      setPasted("");
      setPasteErr("");
      setPasteBusy(false);
    }
  }, [open]);

  // Discover fetch on open and on query change
  useEffect(() => {
    if (!open || tab !== "discover") return;
    let cancelled = false;
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/discover`, { params: { q, limit: 20 } });
        if (!cancelled) setResults(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [open, tab, q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const handleJoinResult = async (item) => {
    setJoiningId(item.id);
    setRowErrors((e) => ({ ...e, [item.id]: undefined }));
    try {
      const conv = await joinConversation({ handle: item.handle });
      try { setActiveConv(conv.id); } catch {}
      onJoined?.(conv);
      onOpenChange(false);
    } catch (e) {
      setRowErrors((er) => ({ ...er, [item.id]: t("failedToJoin") }));
    } finally {
      setJoiningId(null);
    }
  };

  const handlePasteJoin = async () => {
    setPasteErr("");
    const token = extractToken(pasted);
    if (!token) {
      setPasteErr(t("inviteLinkInvalid"));
      return;
    }
    setPasteBusy(true);
    try {
      const conv = await joinConversation({ invite_token: token });
      try { setActiveConv(conv.id); } catch {}
      onJoined?.(conv);
      onOpenChange(false);
    } catch (e) {
      const code = e?.response?.status;
      if (code === 404) setPasteErr(t("inviteLinkInvalid"));
      else setPasteErr(e?.response?.data?.detail || e.message);
    } finally {
      setPasteBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-backdrop)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
      data-testid="join-dialog"
    >
      <div
        className="w-full max-w-lg rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "var(--modal-bg)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px -16px rgba(59,158,255,0.35)", maxHeight: "82vh" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-[#9ABEFF]" />
            <h3 className="text-white font-semibold">{t("joinGroupOrChannel")}</h3>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded-md hover:bg-white/10" data-testid="join-dialog-close">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex items-center gap-2 shrink-0">
          {[
            { key: "discover", label: t("discover") },
            { key: "paste", label: t("pasteInviteLink") },
          ].map((tt) => {
            const active = tab === tt.key;
            return (
              <button
                key={tt.key}
                onClick={() => setTab(tt.key)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium transition"
                style={
                  active
                    ? { background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", color: "white", boxShadow: "0 6px 18px -8px rgba(59,158,255,0.55)" }
                    : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.08)" }
                }
                data-testid={`join-tab-${tt.key}`}
                data-active={active ? "true" : "false"}
              >
                {tt.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          {tab === "discover" ? (
            <>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 mb-3">
                <Search className="w-3.5 h-3.5 text-white/50" />
                <input
                  type="text"
                  placeholder={t("searchPublicChats")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-white outline-none"
                  data-testid="discover-search-input"
                />
                {loading && <Loader2 className="w-3.5 h-3.5 text-white/40 animate-spin" />}
              </div>
              <div className="space-y-2" data-testid="discover-results-list">
                {results.length === 0 && !loading && (
                  <EmptyState
                    icon={Compass}
                    title={t("noPublicChatsFound")}
                    testId="discover-empty"
                  />
                )}
                {results.map((r) => (
                  <ResultRow
                    key={r.id}
                    item={r}
                    joining={joiningId === r.id}
                    errorMsg={rowErrors[r.id]}
                    onJoin={handleJoinResult}
                    t={t}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                placeholder={t("pasteInviteLinkOrToken")}
                value={pasted}
                onChange={(e) => { setPasted(e.target.value); if (pasteErr) setPasteErr(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlePasteJoin(); } }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3B9EFF]"
                data-testid="paste-invite-input"
              />
              <div className="mt-1.5 text-[11px] text-white/45">
                {t("inviteLinkExampleHint")}
              </div>
              {pasteErr && (
                <div className="mt-2 text-xs text-red-300" data-testid="paste-invite-error">
                  {pasteErr}
                </div>
              )}
              <button
                onClick={handlePasteJoin}
                disabled={pasteBusy || !pasted.trim()}
                className="mt-4 w-full px-4 py-2 rounded-xl text-sm text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 8px 20px -8px rgba(59,158,255,0.6)" }}
                data-testid="paste-invite-submit"
              >
                {pasteBusy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t("joinButton")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
