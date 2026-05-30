import React, { useEffect, useRef, useState } from "react";
import { Loader2, Copy as CopyIcon, RefreshCw, Trash2, Check, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { api } from "../../lib/api";

const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

export const InviteLinkSection = ({ conversation, endpoint }) => {
  const { t } = useI18n();
  const { patchConversation } = useMessengerActions();
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  const isAdmin = !!conversation?.is_admin;
  const token = conversation?.invite_token || null;
  const inviteUrl = token ? `${window.location.origin}/join/${token}` : "";

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  const callRegen = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/${endpoint}/${conversation.id}/invite-link`);
      patchConversation(conversation.id, { invite_token: data.invite_token });
      showToast(token ? t("linkRegenerated") : t("linkRegenerated"));
    } catch (e) {
      showToast(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(false); setConfirmRegen(false);
    }
  };
  const callRevoke = async () => {
    setBusy(true);
    try {
      await api.delete(`/${endpoint}/${conversation.id}/invite-link`);
      patchConversation(conversation.id, { invite_token: null });
      showToast(t("linkRevoked"));
    } catch (e) {
      showToast(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };
  const doCopy = async () => {
    const ok = await copyToClipboard(inviteUrl);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); showToast(t("linkCopied")); }
  };

  return (
    <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="invite-link-section">
      <div className="text-[11px] uppercase tracking-wider text-[var(--gm-text-muted)] mb-2">{t("inviteLink")}</div>
      {token ? (
        <>
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5">
            <input readOnly value={inviteUrl} className="flex-1 bg-transparent text-xs text-white outline-none" data-testid="invite-link-url" onClick={(e) => e.target.select()} />
            <button onClick={doCopy} className="p-1.5 rounded-lg hover:bg-white/10 text-[#9ABEFF]" data-testid="invite-link-copy">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <CopyIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 mt-2">
              {!confirmRegen ? (
                <>
                  <button onClick={() => setConfirmRegen(true)} disabled={busy} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 flex items-center gap-1" data-testid="invite-link-regenerate">
                    <RefreshCw className="w-3 h-3" /> {t("regenerate")}
                  </button>
                  <button onClick={callRevoke} disabled={busy} className="text-[11px] px-2.5 py-1 rounded-lg text-red-300 hover:bg-red-500/10 border border-red-400/20 flex items-center gap-1" data-testid="invite-link-revoke">
                    <Trash2 className="w-3 h-3" /> {t("revoke")}
                  </button>
                </>
              ) : (
                <div className="text-[11px] flex items-center gap-2 flex-wrap" data-testid="invite-link-regen-confirm">
                  <span className="text-white/70">{t("regenerateConfirm")}</span>
                  <button onClick={callRegen} disabled={busy} className="px-2 py-0.5 rounded-md text-white" style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }} data-testid="invite-link-regen-yes">{t("yes") || "Yes"}</button>
                  <button onClick={() => setConfirmRegen(false)} disabled={busy} className="px-2 py-0.5 rounded-md text-white/70 hover:bg-white/10">{t("cancel")}</button>
                  {busy && <Loader2 className="w-3 h-3 animate-spin text-white/60" />}
                </div>
              )}
            </div>
          )}
        </>
      ) : isAdmin ? (
        <button onClick={callRegen} disabled={busy} className="px-3 py-1.5 rounded-xl text-xs text-white flex items-center gap-1" style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }} data-testid="invite-link-generate">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {t("generateInviteLink")}
        </button>
      ) : (
        <div className="text-xs text-white/55" data-testid="invite-link-empty">{t("noInviteLink")}</div>
      )}
      {toast && <div className="mt-2 text-[11px] text-[#9ABEFF]">{toast}</div>}
    </div>
  );
};

export const PublicHandleSection = ({ conversation, endpoint }) => {
  const { t } = useI18n();
  const { patchConversation } = useMessengerActions();
  const isAdmin = !!conversation?.is_admin;
  const [isPublic, setIsPublic] = useState(!!conversation?.is_public);
  const [handle, setHandle] = useState(conversation?.handle || "");
  const [status, setStatus] = useState("idle"); // idle|checking|available|taken|invalid
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const debRef = useRef(null);

  useEffect(() => {
    setIsPublic(!!conversation?.is_public);
    setHandle(conversation?.handle || "");
    setStatus("idle");
  }, [conversation?.id, conversation?.is_public, conversation?.handle]);

  useEffect(() => {
    if (!isPublic || !handle) { setStatus("idle"); return; }
    if (!HANDLE_RE.test(handle)) { setStatus("invalid"); return; }
    if (handle === (conversation?.handle || "")) { setStatus("available"); return; }
    setStatus("checking");
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      try {
        try { await api.get(`/conversations/by-handle/${handle}`); setStatus("taken"); return; }
        catch (e) { if (e?.response?.status !== 404) throw e; }
        try { await api.get(`/users/by-username/${handle}`); setStatus("taken"); return; }
        catch (e) { if (e?.response?.status !== 404) throw e; }
        setStatus("available");
      } catch { setStatus("idle"); }
    }, 350);
    return () => clearTimeout(debRef.current);
  }, [isPublic, handle, conversation?.handle]);

  if (!isAdmin) return null;

  const canSave = !busy && (
    (isPublic && status === "available") ||
    (!isPublic) ||
    (isPublic && handle === (conversation?.handle || "") && conversation?.is_public)
  );

  const onSave = async () => {
    setBusy(true);
    try {
      const body = { is_public: isPublic };
      if (isPublic) body.handle = handle;
      const { data } = await api.patch(`/${endpoint}/${conversation.id}`, body);
      patchConversation(conversation.id, {
        is_public: data.is_public,
        handle: data.handle,
      });
      setToast(t("saved"));
      setTimeout(() => setToast(""), 1500);
    } catch (e) {
      setToast(e?.response?.data?.detail || "Failed");
      setTimeout(() => setToast(""), 2200);
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 py-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }} data-testid="public-handle-section">
      <label className="flex items-center justify-between cursor-pointer">
        <div className="text-sm text-white/85">{t("makePublic")}</div>
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="w-4 h-4 accent-[#3B9EFF]" data-testid="public-handle-toggle" />
      </label>
      {isPublic && (
        <div className="mt-2">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5">
            <span className="text-[#9ABEFF] text-sm">@</span>
            <input type="text" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} maxLength={32} placeholder={t("publicHandleLabel")} className="flex-1 bg-transparent text-sm text-white outline-none" data-testid="public-handle-input" />
            {status === "checking" && <Loader2 className="w-3.5 h-3.5 text-white/50 animate-spin" />}
            {status === "available" && <Check className="w-3.5 h-3.5 text-emerald-300" data-testid="public-handle-ok" />}
            {status === "taken" && <X className="w-3.5 h-3.5 text-red-300" data-testid="public-handle-taken" />}
          </div>
          <div className="text-[11px] mt-1">
            {status === "available" && <span className="text-emerald-300">{t("handleAvailable")}</span>}
            {status === "taken" && <span className="text-red-300">{t("handleTaken")}</span>}
            {status === "invalid" && <span className="text-amber-300">{t("handleInvalid")}</span>}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={onSave} disabled={!canSave} className="px-3 py-1.5 rounded-xl text-xs text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }} data-testid="public-handle-save">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("save")}
        </button>
        {toast && <span className="text-[11px] text-[#9ABEFF]">{toast}</span>}
      </div>
    </div>
  );
};
