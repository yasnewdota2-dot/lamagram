import React, { useEffect, useRef, useState } from "react";
import { Camera, Megaphone, Check, X, Loader2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { api } from "../../lib/api";

const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

export const NewChannelDialog = ({ open, onOpenChange }) => {
  const { t } = useI18n();
  const { createChannel, uploadChannelAvatar, setActiveConv } = useMessengerActions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [handle, setHandle] = useState("");
  const [handleStatus, setHandleStatus] = useState("idle"); // idle | checking | available | taken | invalid
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setIsPublic(false);
      setHandle("");
      setHandleStatus("idle");
      setAvatarFile(null);
      setAvatarPreview(null);
      setErr("");
      setBusy(false);
    }
  }, [open]);

  // Debounced handle availability check
  useEffect(() => {
    if (!isPublic || !handle) {
      setHandleStatus("idle");
      return;
    }
    if (!HANDLE_RE.test(handle)) {
      setHandleStatus("invalid");
      return;
    }
    setHandleStatus("checking");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        // Check handle as conversation
        try {
          await api.get(`/conversations/by-handle/${handle}`);
          setHandleStatus("taken");
          return;
        } catch (e) {
          if (e?.response?.status !== 404) throw e;
        }
        // Check handle as username
        try {
          await api.get(`/users/by-username/${handle}`);
          setHandleStatus("taken");
          return;
        } catch (e) {
          if (e?.response?.status !== 404) throw e;
        }
        setHandleStatus("available");
      } catch {
        setHandleStatus("idle");
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [handle, isPublic]);

  const onAvatar = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErr("Avatar too large (max 5MB)");
      return;
    }
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
    setErr("");
  };

  const canCreate =
    title.trim().length >= 3 &&
    title.trim().length <= 50 &&
    (!isPublic || handleStatus === "available") &&
    !busy;

  const onCreate = async () => {
    setErr("");
    if (!canCreate) return;
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        is_public: isPublic,
      };
      if (isPublic) payload.handle = handle;
      const ch = await createChannel(payload);
      if (avatarFile) {
        try {
          await uploadChannelAvatar(ch.id, avatarFile);
        } catch (e) {
          // Non-fatal; channel exists
          console.warn("avatar upload failed", e);
        }
      }
      setActiveConv(ch.id);
      onOpenChange(false);
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail || e.message;
      if (code === 409) setErr(t("handleTaken"));
      else if (code === 400 && /handle/i.test(String(detail))) setErr(t("handleInvalid"));
      else setErr(String(detail));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-backdrop)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
      data-testid="new-channel-dialog"
    >
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden"
        style={{ background: "var(--modal-bg)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px -16px rgba(59,158,255,0.35)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-[#9ABEFF]" />
            <h3 className="text-white font-semibold">{t("newChannel")}</h3>
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded-md hover:bg-white/10" aria-label={t("cancel")} data-testid="new-channel-close">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Avatar */}
          <div className="flex items-center gap-3">
            <label className="cursor-pointer relative" data-testid="new-channel-avatar-label">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden"
                style={{ background: avatarPreview ? "transparent" : "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Megaphone className="w-7 h-7 text-white" />
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white/10 backdrop-blur p-1 rounded-full border border-white/15">
                <Camera className="w-3 h-3 text-white" />
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={onAvatar} data-testid="new-channel-avatar-input" />
            </label>
            <div className="flex-1">
              <input
                type="text"
                placeholder={t("channelTitle")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={50}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3B9EFF]"
                data-testid="new-channel-title-input"
              />
            </div>
          </div>

          {/* Description */}
          <textarea
            placeholder={t("channelDescription")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#3B9EFF] resize-none"
            data-testid="new-channel-desc-input"
          />

          {/* Public toggle */}
          <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer" data-testid="new-channel-public-toggle">
            <div className="text-sm text-white/85">{t("makePublicChannel")}</div>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 accent-[#3B9EFF]"
              data-testid="new-channel-public-checkbox"
            />
          </label>

          {/* Handle input (only when public) */}
          {isPublic && (
            <div data-testid="new-channel-handle-row">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <span className="text-[#9ABEFF] text-sm">@</span>
                <input
                  type="text"
                  placeholder={t("publicHandle")}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  maxLength={32}
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 bg-transparent text-sm text-white outline-none"
                  data-testid="new-channel-handle-input"
                />
                {handleStatus === "checking" && <Loader2 className="w-3.5 h-3.5 text-white/60 animate-spin" />}
                {handleStatus === "available" && <Check className="w-3.5 h-3.5 text-emerald-300" data-testid="new-channel-handle-ok" />}
                {handleStatus === "taken" && <X className="w-3.5 h-3.5 text-red-300" data-testid="new-channel-handle-taken" />}
              </div>
              <div className="mt-1 text-[11px]" data-testid="new-channel-handle-status">
                {handleStatus === "available" && <span className="text-emerald-300">{t("handleAvailable")}</span>}
                {handleStatus === "taken" && <span className="text-red-300">{t("handleTaken")}</span>}
                {handleStatus === "invalid" && <span className="text-amber-300">{t("handleInvalid")}</span>}
              </div>
            </div>
          )}

          {err && <div className="text-xs text-red-300" data-testid="new-channel-error">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded-xl text-sm text-white/80 hover:bg-white/10"
            data-testid="new-channel-cancel"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onCreate}
            disabled={!canCreate}
            className="px-4 py-1.5 rounded-xl text-sm text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)", boxShadow: "0 8px 20px -8px rgba(59,158,255,0.6)" }}
            data-testid="new-channel-create"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("create")}
          </button>
        </div>
      </div>
    </div>
  );
};
