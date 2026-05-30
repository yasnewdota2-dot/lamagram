import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Check, Search, Plus, Camera, Crown, UserMinus, LogOut, Loader2, Ban } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { useI18n } from "../../lib/i18n";
import { InviteLinkSection, PublicHandleSection } from "./InfoSections";
import { useAuth } from "../../lib/auth";
import { useMessengerActions } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { GroupAvatar } from "./GroupAvatar";
import { api } from "../../lib/api";

const NEW_GROUP_HANDLE_RE = /^[a-z0-9_]{3,32}$/;

/* ---------- NewGroupDialog ---------- */
export const NewGroupDialog = ({ open, onOpenChange, onCreated }) => {
  const { t, dir } = useI18n();
  const { user } = useAuth();
  const { searchUsers, createGroup, uploadGroupAvatar, setActiveConv } = useMessengerActions();
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // [{id, username, display_name, avatar_url}]
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [handleField, setHandleField] = useState("");
  const [handleStatus, setHandleStatus] = useState("idle"); // idle|checking|available|taken|invalid
  const handleDeb = useRef(null);
  const tmr = useRef(null);

  useEffect(() => {
    if (!open) {
      setStep(1); setQuery(""); setResults([]); setSelected([]);
      setTitle(""); setDesc(""); setAvatarFile(null); setAvatarPreview(null); setErr("");
      setIsPublic(false); setHandleField(""); setHandleStatus("idle");
    }
  }, [open]);

  // Handle availability debounce (Chunk 6)
  useEffect(() => {
    if (!isPublic || !handleField) { setHandleStatus("idle"); return; }
    if (!NEW_GROUP_HANDLE_RE.test(handleField)) { setHandleStatus("invalid"); return; }
    setHandleStatus("checking");
    clearTimeout(handleDeb.current);
    handleDeb.current = setTimeout(async () => {
      try {
        try { await api.get(`/conversations/by-handle/${handleField}`); setHandleStatus("taken"); return; }
        catch (e) { if (e?.response?.status !== 404) throw e; }
        try { await api.get(`/users/by-username/${handleField}`); setHandleStatus("taken"); return; }
        catch (e) { if (e?.response?.status !== 404) throw e; }
        setHandleStatus("available");
      } catch { setHandleStatus("idle"); }
    }, 350);
    return () => clearTimeout(handleDeb.current);
  }, [isPublic, handleField]);

  useEffect(() => {
    if (tmr.current) clearTimeout(tmr.current);
    if (!query.trim()) { setResults([]); return; }
    tmr.current = setTimeout(async () => {
      try {
        const r = await searchUsers(query);
        setResults((r || []).filter((u) => u.id !== user?.id && !selected.find((s) => s.id === u.id)));
      } catch { setResults([]); }
    }, 250);
    return () => tmr.current && clearTimeout(tmr.current);
  }, [query, searchUsers, user?.id, selected]);

  const toggle = (u) => {
    setSelected((p) => p.find((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]);
    setQuery("");
  };

  const onAvatar = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const handleCreate = async () => {
    if (title.trim().length < 3 || selected.length < 2 || submitting) return;
    if (isPublic && handleStatus !== "available") return;
    setSubmitting(true);
    setErr("");
    try {
      const body = {
        title: title.trim(),
        description: desc.trim() || undefined,
        participant_ids: selected.map((s) => s.id),
      };
      if (isPublic) { body.is_public = true; body.handle = handleField; }
      const conv = await createGroup(body);
      if (avatarFile) {
        try { await uploadGroupAvatar(conv.id, avatarFile); } catch { /* ignore */ }
      }
      onCreated?.(conv);
      setActiveConv(conv.id);
      onOpenChange(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 max-w-md w-full overflow-hidden"
        style={{ background: "rgba(11,11,18,0.92)", backdropFilter: "blur(22px)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
        dir={dir}
        data-testid="new-group-dialog"
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <DialogTitle className="text-base font-semibold m-0">{t("newGroup")}</DialogTitle>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded-md hover:bg-white/10" aria-label={t("cancel")} data-testid="new-group-close">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>
        <DialogDescription className="sr-only">{t("newGroup")}</DialogDescription>

        {step === 1 && (
          <>
            <div className="px-5 pb-2">
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2" data-testid="new-group-chips">
                  {selected.map((u) => (
                    <span key={u.id} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-full"
                      style={{ background: "rgba(59,158,255,0.15)", border: "1px solid rgba(59,158,255,0.3)" }}
                    >
                      {u.display_name || u.username}
                      <button onClick={() => toggle(u)} className="opacity-70 hover:opacity-100" data-testid={`new-group-remove-${u.username}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <Search className="w-4 h-4 text-white/50" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder2")}
                  className="bg-transparent outline-none flex-1 text-sm placeholder:text-white/40"
                  autoFocus
                  data-testid="new-group-search-input"
                />
              </div>
            </div>
            <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto flex flex-col gap-1">
              {results.map((u) => (
                <button key={u.id} onClick={() => toggle(u)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-white/5"
                  data-testid={`new-group-result-${u.username}`}
                >
                  <UserAvatar user={u} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{u.display_name || u.username}</div>
                    <div className="text-[11px] text-white/55 truncate">@{u.username}</div>
                  </div>
                  <Plus className="w-4 h-4 text-[#9ABEFF]" />
                </button>
              ))}
              {query && results.length === 0 && (
                <div className="text-xs text-white/45 px-3 py-2">{t("noResults")}</div>
              )}
            </div>
            <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-xs text-white/60">
                {selected.length < 2 ? t("pickAtLeast2") : t("selectedCount").replace("{n}", String(selected.length))}
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={selected.length < 2}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
                data-testid="new-group-next"
              >
                {t("next")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="px-5 pb-3 flex items-center gap-4">
              <label className="cursor-pointer relative" data-testid="new-group-avatar-label">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
                  >
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={onAvatar} data-testid="new-group-avatar-input" />
              </label>
              <div className="flex-1">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={50}
                  placeholder={t("groupName")}
                  className="w-full bg-transparent outline-none text-sm border-b border-white/15 focus:border-[#3B9EFF] pb-1 placeholder:text-white/40"
                  autoFocus
                  data-testid="new-group-title-input"
                />
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  maxLength={200}
                  placeholder={t("groupDescription")}
                  className="w-full bg-transparent outline-none text-xs mt-2 border-b border-white/10 focus:border-[#3B9EFF] pb-1 placeholder:text-white/35"
                  data-testid="new-group-desc-input"
                />
              </div>
            </div>
            {/* Chunk 6: public toggle + handle */}
            <div className="px-5 pb-2" data-testid="new-group-public-row">
              <label className="flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-sm text-white/85">{t("makeGroupPublic") || t("makePublic")}</span>
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="w-4 h-4 accent-[#3B9EFF]" data-testid="new-group-public-checkbox" />
              </label>
              {isPublic && (
                <div className="mt-2" data-testid="new-group-handle-row">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-2 py-1.5">
                    <span className="text-[#9ABEFF] text-sm">@</span>
                    <input
                      type="text"
                      value={handleField}
                      onChange={(e) => setHandleField(e.target.value.toLowerCase())}
                      maxLength={32}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={t("publicHandle")}
                      className="flex-1 bg-transparent text-sm text-white outline-none"
                      data-testid="new-group-handle-input"
                    />
                    {handleStatus === "checking" && <Loader2 className="w-3.5 h-3.5 text-white/50 animate-spin" />}
                    {handleStatus === "available" && <Check className="w-3.5 h-3.5 text-emerald-300" data-testid="new-group-handle-ok" />}
                    {handleStatus === "taken" && <X className="w-3.5 h-3.5 text-red-300" data-testid="new-group-handle-taken" />}
                  </div>
                  <div className="mt-1 text-[11px]" data-testid="new-group-handle-status">
                    {handleStatus === "available" && <span className="text-emerald-300">{t("handleAvailable")}</span>}
                    {handleStatus === "taken" && <span className="text-red-300">{t("handleTaken")}</span>}
                    {handleStatus === "invalid" && <span className="text-amber-300">{t("handleInvalid")}</span>}
                  </div>
                </div>
              )}
            </div>
            {err && <div className="px-5 pb-2 text-xs text-red-300" data-testid="new-group-error">{err}</div>}
            <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5">
                {t("cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={title.trim().length < 3 || submitting || (isPublic && handleStatus !== "available")}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
                data-testid="new-group-create"
              >
                {submitting ? t("loading") : t("create")}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ---------- GroupInfoDialog ---------- */
export const GroupInfoDialog = ({ open, onOpenChange, conversation }) => {
  const { t, dir } = useI18n();
  const { user } = useAuth();
  const {
    listGroupMembers, updateGroup, uploadGroupAvatar,
    addGroupMembers, removeGroupMember,
    promoteGroupAdmin, demoteGroupAdmin,
    searchUsers,
    listMembers, listBanned, banMember, unbanMember, transferOwnership,
  } = useMessengerActions();
  const [members, setMembers] = useState([]);
  const [memberQ, setMemberQ] = useState("");
  const [banned, setBanned] = useState([]);
  const [bannedOpen, setBannedOpen] = useState(false);
  const [confirmAct, setConfirmAct] = useState(null); // {type:'ban'|'transfer', target}
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState([]);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const debTmr = useRef(null);
  const memDebTmr = useRef(null);

  const isAdmin = !!conversation?.group?.is_admin;
  const isOwner = !!conversation?.group?.is_owner;
  const convId = conversation?.id;

  useEffect(() => {
    if (open && convId) {
      listMembers(convId, "group", "").then(setMembers).catch(() => {});
      if (isAdmin) listBanned(convId, "group").then(setBanned).catch(() => setBanned([]));
      setTitleDraft(conversation?.group?.title || "");
      setDescDraft(conversation?.group?.description || "");
      setError("");
    } else {
      setEditingTitle(false); setEditingDesc(false); setAddOpen(false); setAddQuery("");
      setMemberQ(""); setBannedOpen(false); setConfirmAct(null);
    }
  }, [open, convId, listMembers, listBanned, isAdmin, conversation?.group?.title, conversation?.group?.description]);

  // Debounced search of members
  useEffect(() => {
    if (!open || !convId) return;
    if (memDebTmr.current) clearTimeout(memDebTmr.current);
    memDebTmr.current = setTimeout(async () => {
      try {
        const r = await listMembers(convId, "group", memberQ);
        setMembers(r || []);
      } catch {}
    }, 250);
    return () => memDebTmr.current && clearTimeout(memDebTmr.current);
  }, [memberQ, open, convId, listMembers]);

  useEffect(() => {
    if (debTmr.current) clearTimeout(debTmr.current);
    if (!addQuery.trim()) { setAddResults([]); return; }
    debTmr.current = setTimeout(async () => {
      try {
        const r = await searchUsers(addQuery);
        setAddResults((r || []).filter((u) => !members.find((m) => m.id === u.id)));
      } catch { setAddResults([]); }
    }, 250);
    return () => debTmr.current && clearTimeout(debTmr.current);
  }, [addQuery, searchUsers, members]);

  const saveTitle = async () => {
    if (titleDraft.trim().length < 3) { setEditingTitle(false); return; }
    try {
      await updateGroup(convId, { title: titleDraft.trim() });
      setEditingTitle(false);
    } catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const saveDesc = async () => {
    try {
      await updateGroup(convId, { description: descDraft.trim() });
      setEditingDesc(false);
    } catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const onAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await uploadGroupAvatar(convId, f); }
    catch (err) { setError(err?.response?.data?.detail || err.message); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const refreshMembers = () => listMembers(convId, "group", memberQ).then(setMembers).catch(() => {});
  const refreshBanned = () => listBanned(convId, "group").then(setBanned).catch(() => setBanned([]));
  const handleAdd = async (u) => {
    try { await addGroupMembers(convId, [u.id]); refreshMembers(); setAddQuery(""); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleRemove = async (uid) => {
    try { await removeGroupMember(convId, uid); refreshMembers(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleBan = async (uid) => {
    try { await banMember(convId, uid, "group"); refreshMembers(); refreshBanned(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleUnban = async (uid) => {
    try { await unbanMember(convId, uid, "group"); refreshBanned(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleTransfer = async (uid) => {
    try { await transferOwnership(convId, uid, "group"); refreshMembers(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handlePromote = async (uid) => {
    try { await promoteGroupAdmin(convId, uid); refreshMembers(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleDemote = async (uid) => {
    try { await demoteGroupAdmin(convId, uid); refreshMembers(); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleLeave = async () => {
    if (!window.confirm(t("leaveGroup") + "?")) return;
    try {
      const res = await removeGroupMember(convId, user.id);
      if (res?.deleted || res?.ok) onOpenChange(false);
    } catch (e) { setError(e?.response?.data?.detail || e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-md w-full overflow-hidden"
        style={{ background: "rgba(11,11,18,0.94)", backdropFilter: "blur(22px)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
        dir={dir}
        data-testid="group-info-dialog"
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <DialogTitle className="text-base font-semibold m-0">{t("groupInfo")}</DialogTitle>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded-md hover:bg-white/10" data-testid="group-info-close">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>
        <DialogDescription className="sr-only">{t("groupInfo")}</DialogDescription>

        <div className="px-5 pb-3 flex items-center gap-4">
          <label className={isAdmin ? "relative cursor-pointer" : "relative"}>
            <GroupAvatar group={conversation?.group} size={64} />
            {isAdmin && (
              <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                <Camera className="w-4 h-4 text-white" />
              </span>
            )}
            {isAdmin && (
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onAvatar} data-testid="group-info-avatar-input" />
            )}
          </label>
          <div className="min-w-0 flex-1">
            {editingTitle && isAdmin ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                autoFocus
                className="bg-transparent outline-none w-full border-b border-white/15 focus:border-[#3B9EFF] text-base font-semibold"
                data-testid="group-info-title-edit"
              />
            ) : (
              <div
                onClick={() => isAdmin && setEditingTitle(true)}
                className={`text-base font-semibold truncate ${isAdmin ? "cursor-pointer hover:opacity-80" : ""}`}
                data-testid="group-info-title"
              >
                {conversation?.group?.title || "Group"}
              </div>
            )}
            {editingDesc && isAdmin ? (
              <input
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={saveDesc}
                onKeyDown={(e) => e.key === "Enter" && saveDesc()}
                autoFocus
                placeholder={t("groupDescription")}
                className="bg-transparent outline-none w-full border-b border-white/10 focus:border-[#3B9EFF] text-xs text-white/70 mt-1"
                data-testid="group-info-desc-edit"
              />
            ) : (
              <div
                onClick={() => isAdmin && setEditingDesc(true)}
                className={`text-xs text-white/65 truncate mt-0.5 ${isAdmin ? "cursor-pointer hover:opacity-80" : ""}`}
                data-testid="group-info-desc"
              >
                {conversation?.group?.description || (isAdmin ? t("groupDescription") : "")}
              </div>
            )}
            <div className="text-[10px] uppercase tracking-wider text-white/45 mt-1">
              {t("membersCount").replace("{n}", String(members.length))}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="px-5 pb-2">
            {!addOpen ? (
              <button onClick={() => setAddOpen(true)} className="text-xs text-[#9ABEFF] hover:underline" data-testid="group-info-add-toggle">
                <Plus className="inline w-3 h-3 mr-0.5" /> {t("addMembers")}
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <Search className="w-4 h-4 text-white/50" />
                  <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder={t("searchPlaceholder2")} className="bg-transparent outline-none flex-1 text-sm placeholder:text-white/40" data-testid="group-info-add-search" autoFocus />
                  <button onClick={() => { setAddOpen(false); setAddQuery(""); }} className="p-0.5 rounded text-white/55 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {addResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto mt-1 flex flex-col gap-0.5">
                    {addResults.map((u) => (
                      <button key={u.id} onClick={() => handleAdd(u)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left" data-testid={`group-info-add-result-${u.username}`}>
                        <UserAvatar user={u} size={28} />
                        <span className="text-xs truncate">{u.display_name || u.username}</span>
                        <Plus className="ml-auto w-3.5 h-3.5 text-[#9ABEFF]" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="px-5 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--bg-glass)", border: "1px solid var(--border-glass)" }}>
            <Search className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <input
              value={memberQ}
              onChange={(e) => setMemberQ(e.target.value)}
              placeholder={t("searchMembers")}
              className="bg-transparent outline-none flex-1 text-sm"
              style={{ color: "var(--text-primary)" }}
              data-testid="group-info-member-search"
            />
            {memberQ && (
              <button onClick={() => setMemberQ("")} className="p-0.5 rounded text-white/55 hover:text-white" aria-label="clear">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto" data-testid="group-info-members-list">
          {members.map((m) => {
            const isMe = m.id === user?.id;
            const isMemberOwner = !!m.is_owner;
            return (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl group" data-testid={`group-info-member-${m.username}`}>
                <UserAvatar user={m} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{m.display_name || m.username}{isMe && <span className="text-[10px] text-white/55"> ({t("you").trim() || "you"})</span>}</div>
                  <div className="text-[10px] text-white/45 truncate">@{m.username}</div>
                </div>
                {isMemberOwner ? (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-md" style={{ background: "linear-gradient(135deg, #F59E0B, #FBBF24)", border: "1px solid rgba(245,158,11,0.5)", color: "#1a1305" }} data-testid={`group-info-owner-badge-${m.username}`}>
                    <Crown className="inline w-2.5 h-2.5 mr-0.5" />{t("owner")}
                  </span>
                ) : m.is_admin && (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-md" style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "#C9B8FF" }} data-testid={`group-info-admin-badge-${m.username}`}>
                    <Crown className="inline w-2.5 h-2.5 mr-0.5" />{t("adminLabel")}
                  </span>
                )}
                {isAdmin && !isMe && !isMemberOwner && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {m.is_admin ? (
                      <button onClick={() => handleDemote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`group-info-demote-${m.username}`}>{t("demote")}</button>
                    ) : (
                      <button onClick={() => handlePromote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`group-info-promote-${m.username}`}>{t("promote")}</button>
                    )}
                    {isOwner && m.is_admin && (
                      <button onClick={() => setConfirmAct({ type: "transfer", target: m })} className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300" data-testid={`group-info-transfer-${m.username}`} title={t("transferOwnership")}>
                        <Crown className="inline w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => setConfirmAct({ type: "ban", target: m })} className="p-1 rounded-md text-red-300 hover:bg-white/5" data-testid={`group-info-ban-${m.username}`} title={t("banFromGroup")}>
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleRemove(m.id)} className="p-1 rounded-md text-red-300 hover:bg-white/5" data-testid={`group-info-remove-${m.username}`} title={t("remove") || "Remove"}>
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && banned.length > 0 && (
          <div className="px-5 pb-3" data-testid="group-info-banned-section">
            <button
              onClick={() => setBannedOpen((v) => !v)}
              className="w-full flex items-center justify-between text-[11px] uppercase tracking-wider mb-1"
              style={{ color: "var(--text-muted)" }}
              data-testid="group-info-banned-toggle"
            >
              <span>{t("bannedUsers")} · {banned.length}</span>
              <span>{bannedOpen ? "−" : "+"}</span>
            </button>
            {bannedOpen && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto" data-testid="group-info-banned-list">
                {banned.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--bg-glass)" }} data-testid={`group-info-banned-${b.username}`}>
                    <UserAvatar user={b} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{b.display_name || b.username}</div>
                      <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{b.username}</div>
                    </div>
                    <button onClick={() => handleUnban(b.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" style={{ color: "var(--text-secondary)" }} data-testid={`group-info-unban-${b.username}`}>
                      {t("unban")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {confirmAct && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setConfirmAct(null)} data-testid="group-info-confirm-overlay">
            <div className="rounded-2xl p-5 max-w-sm w-full" style={{ background: "var(--bg-glass-strong)", border: "1px solid var(--border-glass)", backdropFilter: "blur(20px)" }} onClick={(e) => e.stopPropagation()} data-testid="group-info-confirm-dialog">
              <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                {confirmAct.type === "ban" ? t("banFromGroup") : t("transferOwnership")}
              </div>
              <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                {confirmAct.type === "ban"
                  ? t("banConfirm").replace("{name}", confirmAct.target.display_name || confirmAct.target.username)
                  : t("transferOwnershipConfirm").replace("{name}", confirmAct.target.display_name || confirmAct.target.username)}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirmAct(null)} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: "var(--text-secondary)" }} data-testid="group-info-confirm-cancel">{t("cancel")}</button>
                <button
                  onClick={async () => {
                    const t2 = confirmAct.target.id;
                    const isBan = confirmAct.type === "ban";
                    setConfirmAct(null);
                    if (isBan) await handleBan(t2); else await handleTransfer(t2);
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm text-white"
                  style={confirmAct.type === "ban" ? { background: "#E5484D" } : { background: "linear-gradient(135deg, #F59E0B, #FBBF24)" }}
                  data-testid="group-info-confirm-proceed"
                >
                  {confirmAct.type === "ban" ? t("ban") : t("transferOwnership")}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <div className="px-5 pb-2 text-xs text-red-300" data-testid="group-info-error">{error}</div>}

        <div className="px-5 pb-3 space-y-3">
          <PublicHandleSection conversation={conversation} endpoint="groups" />
          <InviteLinkSection conversation={conversation} endpoint="groups" />
        </div>

        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={handleLeave} className="w-full px-3 py-2 rounded-lg text-sm font-medium text-red-300 hover:bg-red-500/10 flex items-center justify-center gap-2" data-testid="group-info-leave">
            <LogOut className="w-4 h-4" /> {t("leaveGroup")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
