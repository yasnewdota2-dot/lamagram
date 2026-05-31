import React, { useEffect, useRef, useState } from "react";
import { X, Megaphone, LogOut, Search, Crown, UserMinus, Ban, Bell, BellOff } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessengerActions } from "../../lib/messenger";
import { GroupAvatar } from "./GroupAvatar";
import { UserAvatar } from "../Avatar";
import { InviteLinkSection, PublicHandleSection } from "./InfoSections";
import { EditRoleModal } from "./GroupDialogs";

export const ChannelInfoDialog = ({ open, onOpenChange, conversation }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    removeChannelMember,
    promoteChannelAdmin, demoteChannelAdmin,
    listMembers, listBanned, banMember, unbanMember, transferOwnership,
    setMuted,
    updateAdminRole,
  } = useMessengerActions();

  const [members, setMembers] = useState([]);
  const [memberQ, setMemberQ] = useState("");
  const [banned, setBanned] = useState([]);
  const [bannedOpen, setBannedOpen] = useState(false);
  const [confirmAct, setConfirmAct] = useState(null);
  const [editRoleFor, setEditRoleFor] = useState(null);
  const [error, setError] = useState("");
  const memDebTmr = useRef(null);

  const g = conversation?.group || {};
  const isAdmin = !!g.is_admin;
  const isOwner = !!g.is_owner;
  const convId = conversation?.id;

  useEffect(() => {
    if (open && convId) {
      listMembers(convId, "channel", "").then(setMembers).catch(() => {});
      if (isAdmin) listBanned(convId, "channel").then(setBanned).catch(() => setBanned([]));
      setMemberQ(""); setBannedOpen(false); setConfirmAct(null); setError("");
    }
  }, [open, convId, isAdmin, listMembers, listBanned]);

  useEffect(() => {
    if (!open || !convId) return;
    if (memDebTmr.current) clearTimeout(memDebTmr.current);
    memDebTmr.current = setTimeout(async () => {
      try { setMembers(await listMembers(convId, "channel", memberQ) || []); } catch {}
    }, 250);
    return () => memDebTmr.current && clearTimeout(memDebTmr.current);
  }, [memberQ, open, convId, listMembers]);

  if (!open || !conversation) return null;

  const refreshMembers = () => listMembers(convId, "channel", memberQ).then(setMembers).catch(() => {});
  const refreshBanned = () => listBanned(convId, "channel").then(setBanned).catch(() => setBanned([]));

  const handlePromote = async (uid) => { try { await promoteChannelAdmin(convId, uid); refreshMembers(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };
  const handleDemote = async (uid) => { try { await demoteChannelAdmin(convId, uid); refreshMembers(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };
  const handleRemove = async (uid) => { try { await removeChannelMember(convId, uid); refreshMembers(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };
  const handleBan = async (uid) => { try { await banMember(convId, uid, "channel"); refreshMembers(); refreshBanned(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };
  const handleUnban = async (uid) => { try { await unbanMember(convId, uid, "channel"); refreshBanned(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };
  const handleTransfer = async (uid) => { try { await transferOwnership(convId, uid, "channel"); refreshMembers(); } catch (e) { setError(e?.response?.data?.detail || e.message); } };

  const onLeave = async () => { try { if (removeChannelMember) await removeChannelMember(convId, "self"); } catch {} onOpenChange(false); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--modal-backdrop)", backdropFilter: "blur(8px)" }} onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }} data-testid="channel-info-dialog">
      <div className="w-full max-w-md rounded-3xl overflow-hidden flex flex-col" style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0 sticky top-0 z-10" style={{ background: "var(--modal-bg-strong, var(--modal-bg))", borderBottom: "1px solid var(--border-glass)" }}>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: "var(--text-primary)" }}
            data-testid="channel-info-close"
            aria-label={t("close") || "Close"}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Megaphone className="w-4 h-4 text-[#9ABEFF]" />
            <h3 className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>{g.title || "Channel"}</h3>
          </div>
          <button
            onClick={onLeave}
            className="p-1.5 rounded-md hover:bg-red-500/10"
            style={{ color: "var(--danger, #E5484D)" }}
            data-testid="channel-info-leave"
            aria-label={t("leaveChannel")}
            title={t("leaveChannel")}
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-3">
              <GroupAvatar group={{ title: g.title, avatar_url: g.avatar_url }} size={56} />
              <div className="min-w-0">
                <div className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>{g.title}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {(g.member_count || 0)} {t("subscribers")}
                  {conversation.is_public && conversation.handle && <span className="ml-2 text-white/40">· @{conversation.handle}</span>}
                </div>
                {g.description && <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{g.description}</div>}
              </div>
            </div>
            <PublicHandleSection conversation={conversation} endpoint="channels" />
            {isAdmin && <InviteLinkSection conversation={conversation} endpoint="channels" />}
            {/* Phase 11 — mute toggle visible to ALL members */}
            <button
              onClick={async () => { try { await setMuted(convId, !conversation.is_muted); } catch {} }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl"
              style={{ background: "var(--bg-glass)", border: "1px solid var(--border-glass)" }}
              data-testid="channel-info-mute-toggle"
            >
              <span className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
                {conversation.is_muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {conversation.is_muted ? t("unmute") : t("mute")}
              </span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {conversation.is_muted ? t("on") || "ON" : t("off") || "OFF"}
              </span>
            </button>
            {error && <div className="text-xs" style={{ color: "#E5484D" }}>{error}</div>}
          </div>

          {/* Member search */}
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--bg-glass)", border: "1px solid var(--border-glass)" }}>
              <Search className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
              <input value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder={t("searchMembers")} className="bg-transparent outline-none flex-1 text-sm" style={{ color: "var(--text-primary)" }} data-testid="channel-info-member-search" />
              {memberQ && <button onClick={() => setMemberQ("")} className="p-0.5 rounded text-white/55 hover:text-white" aria-label="clear"><X className="w-3 h-3" /></button>}
            </div>
          </div>

          {/* Members list */}
          <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto" data-testid="channel-info-members-list">
            {members.map((m) => {
              const isMe = m.id === user?.id;
              const isMemberOwner = !!m.is_owner;
              return (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl group" data-testid={`channel-info-member-${m.username}`}>
                  <UserAvatar user={m} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{m.display_name || m.username}{isMe && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}> (you)</span>}</div>
                    <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{m.username}</div>
                  </div>
                  {isMemberOwner ? (
                    <span className="inline-flex items-center gap-0.5 text-[9px] leading-none uppercase tracking-wider px-1.5 h-[18px] rounded-md shrink-0" style={{ background: "linear-gradient(135deg, #F59E0B, #FBBF24)", border: "1px solid rgba(245,158,11,0.5)", color: "#1a1305" }} data-testid={`channel-info-owner-badge-${m.username}`}>
                      <Crown className="w-2.5 h-2.5" />{t("owner")}
                    </span>
                  ) : m.is_admin && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] leading-none uppercase tracking-wider px-1.5 h-[18px] rounded-md shrink-0" style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "#C9B8FF" }} data-testid={`channel-info-admin-badge-${m.username}`}>
                      <Crown className="w-2.5 h-2.5" />{t("adminLabel")}
                    </span>
                  )}
                  {isAdmin && !isMe && !isMemberOwner && (
                    <div className="flex items-center gap-1">
                      {m.is_admin ? (
                        <button onClick={() => handleDemote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`channel-info-demote-${m.username}`}>{t("demote")}</button>
                      ) : (
                        <button onClick={() => handlePromote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`channel-info-promote-${m.username}`}>{t("promote")}</button>
                      )}
                      {m.is_admin && (
                        <button onClick={() => setEditRoleFor(m)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`channel-info-edit-role-${m.username}`} title={t("editRole")}>
                          {t("editRole")}
                        </button>
                      )}
                      {isOwner && m.is_admin && (
                        <button onClick={() => setConfirmAct({ type: "transfer", target: m })} className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300" data-testid={`channel-info-transfer-${m.username}`} title={t("transferOwnership")}>
                          <Crown className="inline w-3 h-3" />
                        </button>
                      )}
                      <button onClick={() => setConfirmAct({ type: "ban", target: m })} className="p-1 rounded-md text-red-300 hover:bg-white/5" data-testid={`channel-info-ban-${m.username}`} title={t("banFromChannel")}>
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleRemove(m.id)} className="p-1 rounded-md text-red-300 hover:bg-white/5" data-testid={`channel-info-remove-${m.username}`}>
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isAdmin && banned.length > 0 && (
            <div className="px-5 pb-3" data-testid="channel-info-banned-section">
              <button onClick={() => setBannedOpen((v) => !v)} className="w-full flex items-center justify-between text-[11px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }} data-testid="channel-info-banned-toggle">
                <span>{t("bannedUsers")} · {banned.length}</span>
                <span>{bannedOpen ? "−" : "+"}</span>
              </button>
              {bannedOpen && (
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto" data-testid="channel-info-banned-list">
                  {banned.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--bg-glass)" }} data-testid={`channel-info-banned-${b.username}`}>
                      <UserAvatar user={b} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{b.display_name || b.username}</div>
                        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{b.username}</div>
                      </div>
                      <button onClick={() => handleUnban(b.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" style={{ color: "var(--text-secondary)" }} data-testid={`channel-info-unban-${b.username}`}>
                        {t("unban")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {confirmAct && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setConfirmAct(null)} data-testid="channel-info-confirm-overlay">
            <div className="rounded-2xl p-5 max-w-sm w-full" style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", backdropFilter: "blur(20px)" }} onClick={(e) => e.stopPropagation()} data-testid="channel-info-confirm-dialog">
              <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                {confirmAct.type === "ban" ? t("banFromChannel") : t("transferOwnership")}
              </div>
              <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                {confirmAct.type === "ban"
                  ? t("banConfirm").replace("{name}", confirmAct.target.display_name || confirmAct.target.username)
                  : t("transferOwnershipConfirm").replace("{name}", confirmAct.target.display_name || confirmAct.target.username)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirmAct(null)} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: "var(--text-secondary)" }} data-testid="channel-info-confirm-cancel">{t("cancel")}</button>
                <button
                  onClick={async () => { const t2 = confirmAct.target.id; const isBan = confirmAct.type === "ban"; setConfirmAct(null); if (isBan) await handleBan(t2); else await handleTransfer(t2); }}
                  className="px-3 py-1.5 rounded-lg text-sm text-white"
                  style={confirmAct.type === "ban" ? { background: "#E5484D" } : { background: "linear-gradient(135deg, #F59E0B, #FBBF24)" }}
                  data-testid="channel-info-confirm-proceed"
                >
                  {confirmAct.type === "ban" ? t("ban") : t("transferOwnership")}
                </button>
              </div>
            </div>
          </div>
        )}
        {editRoleFor && (
          <EditRoleModal
            member={editRoleFor}
            kind="channel"
            onClose={() => setEditRoleFor(null)}
            onSave={async ({ title, permissions }) => {
              try {
                await updateAdminRole(convId, "channel", editRoleFor.id, { title, permissions });
                setMembers((prev) => prev.map((m) =>
                  m.id === editRoleFor.id ? { ...m, admin_title: (title || "").trim() || undefined, admin_permissions: permissions } : m
                ));
                setEditRoleFor(null);
              } catch (e) { setError(e?.response?.data?.detail || e.message); }
            }}
          />
        )}
      </div>
    </div>
  );
};
