import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Copy, Check, MessageCircle, Ban, Trash2, Flag } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessengerActions, useConversations } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { OnlineDot } from "./OnlineDot";
import { formatRelative } from "../../lib/time";
import { useIsMobile } from "../../lib/useIsMobile";

// ---------------- Context ----------------
const UserProfileContext = createContext({ openUserProfile: () => {} });
export const useUserProfile = () => useContext(UserProfileContext);

export const UserProfileProvider = ({ children }) => {
  // target may be a user-object, a string username, or { id } / { username }
  const [target, setTarget] = useState(null);

  const open = useCallback((arg) => {
    if (!arg) return;
    if (typeof arg === "string") setTarget({ username: arg });
    else setTarget(arg);
  }, []);
  const close = useCallback(() => setTarget(null), []);

  return (
    <UserProfileContext.Provider value={{ openUserProfile: open, closeUserProfile: close }}>
      {children}
      <AnimatePresence>
        {target && (
          <UserProfileDrawer key="profile-drawer" target={target} onClose={close} />
        )}
      </AnimatePresence>
    </UserProfileContext.Provider>
  );
};

// ---------------- Drawer ----------------
const UserProfileDrawer = ({ target, onClose }) => {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { user: me, setUser: setMe } = useAuth();
  const conversations = useConversations();
  const { openOrCreateConversation, blockUser, unblockUser, deleteConversation, reportUser, setActiveConv } = useMessengerActions();

  const [user, setUser] = useState(target?.id && target?.username ? target : null);
  const [loading, setLoading] = useState(!user);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'block' | 'unblock' | 'delete' | 'report'
  const [reportReason, setReportReason] = useState("");

  // Fetch full user (if only partial passed)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (user && user.id && user.username) return;
      setLoading(true);
      setErr("");
      try {
        let res;
        if (target.id) res = await api.get(`/users/${target.id}`);
        else if (target.username) res = await api.get(`/users/by-username/${target.username}`);
        else throw new Error("missing identifier");
        if (!cancelled) setUser(res.data);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "User not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.username]);

  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMe = !!me && !!user && me.id === user.id;
  const isBlocked = !!user && (me?.blocked_users || []).includes(user.id);
  const existingDM = !isMe && user
    ? conversations.find(
        (c) => (c.kind === "dm" || (!c.kind && c.other_user)) && c.other_user?.id === user.id
      )
    : null;

  const doCopyUsername = async () => {
    if (!user?.username) return;
    try {
      await navigator.clipboard.writeText(`@${user.username}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const doMessage = async () => {
    if (!user || isMe) return;
    setBusy(true);
    try {
      const conv = await openOrCreateConversation(user.id);
      onClose();
      if (conv?.id) setActiveConv(conv.id);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const doBlockToggle = async () => {
    if (!user) return;
    setBusy(true);
    try {
      if (isBlocked) await unblockUser(user.id);
      else await blockUser(user.id);
      // Patch local me.blocked_users so the toggle reflects instantly.
      setMe?.((m) => {
        if (!m) return m;
        const cur = new Set(m.blocked_users || []);
        if (isBlocked) cur.delete(user.id); else cur.add(user.id);
        return { ...m, blocked_users: Array.from(cur) };
      });
      setConfirm(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const doDeleteChat = async () => {
    if (!existingDM) return;
    setBusy(true);
    try {
      await deleteConversation(existingDM.id);
      setConfirm(null);
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const doReport = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await reportUser(user.id, reportReason);
      setConfirm(null);
      setReportReason("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const panelInit = isMobile ? { y: "100%", opacity: 0.7 } : { x: 320, opacity: 0 };
  const panelAnim = isMobile ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 };
  const panelExit = isMobile ? { y: "100%", opacity: 0 } : { x: 320, opacity: 0 };

  const status = !user
    ? ""
    : user.is_online
    ? t("online") || "Online"
    : user.last_seen
    ? `${t("lastSeen") || "Last seen"} ${formatRelative(user.last_seen, "en")}`
    : t("lastSeenRecently") || "Last seen recently";

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={isMobile ? undefined : onClose}
        data-testid="profile-drawer-backdrop"
      />

      {/* Panel */}
      <motion.div
        initial={panelInit}
        animate={panelAnim}
        exit={panelExit}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className={
          isMobile
            ? "fixed inset-x-0 bottom-0 top-12 z-50 rounded-t-3xl"
            : "fixed right-0 top-0 bottom-0 z-50 w-[360px] max-w-[92vw]"
        }
        style={{
          background: "var(--bg-glass-strong)",
          borderLeft: isMobile ? "none" : "1px solid var(--border-glass)",
          borderTop: isMobile ? "1px solid var(--border-glass)" : "none",
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          boxShadow: isMobile ? "0 -8px 32px rgba(0,0,0,0.35)" : "-8px 0 32px rgba(0,0,0,0.35)",
        }}
        data-testid="user-profile-drawer"
        role="dialog"
        aria-modal="true"
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-glass)" }}
          >
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("profile") || "Profile"}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10"
              aria-label="close"
              data-testid="profile-close-button"
            >
              <X className="w-4 h-4" style={{ color: "var(--text-primary)" }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-6">
            {loading && (
              <div className="text-center text-sm py-10" style={{ color: "var(--text-muted)" }} data-testid="profile-loading">
                {t("loading") || "Loading…"}
              </div>
            )}
            {!loading && err && !user && (
              <div className="text-center text-sm py-10" style={{ color: "#E5484D" }} data-testid="profile-error">
                {err}
              </div>
            )}
            {!loading && user && (
              <>
                {/* Avatar */}
                <div className="flex flex-col items-center text-center">
                  <div className="relative">
                    <UserAvatar user={user} size={isMobile ? 120 : 96} ring testId="profile-avatar" />
                    {user.is_online && (
                      <span className="absolute bottom-1 right-1">
                        <OnlineDot online size={14} />
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-4 text-xl font-bold"
                    style={{ color: "var(--text-primary)" }}
                    data-testid="profile-display-name"
                  >
                    {user.display_name || user.username}
                  </div>
                  <button
                    onClick={doCopyUsername}
                    className="mt-1 flex items-center gap-1.5 text-sm hover:opacity-80"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid="profile-username-copy"
                    aria-label="copy username"
                  >
                    <span data-testid="profile-username">@{user.username}</span>
                    {copied ? (
                      <Check className="w-3.5 h-3.5" style={{ color: "#10B981" }} />
                    ) : (
                      <Copy className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                    )}
                  </button>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }} data-testid="profile-status">
                    {status}
                  </div>
                  {user.bio && (
                    <div
                      className="mt-4 text-sm leading-relaxed max-w-[280px]"
                      style={{ color: "var(--text-secondary)" }}
                      data-testid="profile-bio"
                    >
                      {user.bio.length > 200 ? `${user.bio.slice(0, 200)}…` : user.bio}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isMe && (
                  <div className="mt-6 flex flex-col gap-2">
                    <button
                      onClick={doMessage}
                      disabled={busy}
                      className="h-12 rounded-2xl flex items-center justify-center gap-2 text-white text-sm font-semibold disabled:opacity-60"
                      style={{
                        background: "var(--accent-gradient)",
                        boxShadow: "0 8px 24px -10px var(--accent-glow)",
                      }}
                      data-testid="profile-action-message"
                    >
                      <MessageCircle className="w-4 h-4" />
                      {t("messageButton") || "Message"}
                    </button>

                    <button
                      onClick={() => setConfirm(isBlocked ? "unblock" : "block")}
                      disabled={busy}
                      className="h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-60"
                      style={{
                        background: "var(--bg-glass)",
                        border: "1px solid var(--border-glass)",
                        color: "#E5484D",
                      }}
                      data-testid="profile-action-block"
                    >
                      <Ban className="w-4 h-4" />
                      {isBlocked ? (t("unblock") || "Unblock") : (t("block") || "Block")}
                    </button>

                    {existingDM && (
                      <button
                        onClick={() => setConfirm("delete")}
                        disabled={busy}
                        className="h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-60"
                        style={{
                          background: "var(--bg-glass)",
                          border: "1px solid var(--border-glass)",
                          color: "#E5484D",
                        }}
                        data-testid="profile-action-delete-chat"
                      >
                        <Trash2 className="w-4 h-4" />
                        {t("deleteChat") || "Delete chat"}
                      </button>
                    )}

                    <button
                      onClick={() => setConfirm("report")}
                      disabled={busy}
                      className="h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-60"
                      style={{
                        background: "var(--bg-glass)",
                        border: "1px solid var(--border-glass)",
                        color: "var(--text-secondary)",
                      }}
                      data-testid="profile-action-report"
                    >
                      <Flag className="w-4 h-4" />
                      {t("report") || "Report"}
                    </button>
                  </div>
                )}
                {err && user && (
                  <div className="mt-3 text-xs text-center" style={{ color: "#E5484D" }} data-testid="profile-inline-error">
                    {err}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Confirmation modal — block/unblock/delete/report */}
        {confirm && (
          <div
            className="absolute inset-0 z-10 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => !busy && setConfirm(null)}
            data-testid="profile-confirm-overlay"
          >
            <div
              className="rounded-2xl p-5 max-w-sm w-full"
              style={{
                background: "var(--bg-glass-strong)",
                border: "1px solid var(--border-glass)",
                backdropFilter: "blur(20px)",
              }}
              onClick={(e) => e.stopPropagation()}
              data-testid="profile-confirm-dialog"
            >
              <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                {confirm === "delete" &&
                  (t("deleteChatConfirm") || "Delete chat with {name}? Both sides lose it.").replace(
                    "{name}",
                    user?.display_name || user?.username || ""
                  )}
                {confirm === "block" && (t("block") || "Block")}
                {confirm === "unblock" && (t("unblock") || "Unblock")}
                {confirm === "report" && (t("report") || "Report")}
              </div>
              <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                {confirm === "block" && (t("blockUsersConfirm") || "Block this user? They won't be able to message you.")}
                {confirm === "unblock" && (t("unblockConfirm") || "Unblock this user? They will be able to message you again.")}
                {confirm === "report" && (
                  <textarea
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    rows={3}
                    placeholder={t("reportReason")}
                    className="w-full rounded-lg p-2 text-sm"
                    style={{
                      background: "var(--bg-glass)",
                      border: "1px solid var(--border-glass)",
                      color: "var(--text-primary)",
                    }}
                    data-testid="profile-report-reason"
                  />
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirm(null)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
                  style={{ color: "var(--text-secondary)" }}
                  data-testid="profile-confirm-cancel"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={() => {
                    if (confirm === "block" || confirm === "unblock") doBlockToggle();
                    else if (confirm === "delete") doDeleteChat();
                    else if (confirm === "report") doReport();
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50"
                  style={
                    confirm === "delete" || confirm === "block"
                      ? { background: "#E5484D" }
                      : { background: "var(--accent-gradient)" }
                  }
                  data-testid="profile-confirm-proceed"
                >
                  {confirm === "delete"
                    ? t("deleteChat") || "Delete chat"
                    : confirm === "block"
                    ? t("block") || "Block"
                    : confirm === "unblock"
                    ? t("unblock") || "Unblock"
                    : t("report") || "Report"}
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
};

export default UserProfileDrawer;
