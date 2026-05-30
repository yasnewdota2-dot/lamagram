import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Check, Search, Plus, Camera, Crown, UserMinus, LogOut } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessengerActions } from "../../lib/messenger";
import { UserAvatar } from "../Avatar";
import { GroupAvatar } from "./GroupAvatar";

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
  const tmr = useRef(null);

  useEffect(() => {
    if (!open) {
      setStep(1); setQuery(""); setResults([]); setSelected([]);
      setTitle(""); setDesc(""); setAvatarFile(null); setAvatarPreview(null); setErr("");
    }
  }, [open]);

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
    setSubmitting(true);
    setErr("");
    try {
      const conv = await createGroup({
        title: title.trim(),
        description: desc.trim() || undefined,
        participant_ids: selected.map((s) => s.id),
      });
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
            {err && <div className="px-5 pb-2 text-xs text-red-300" data-testid="new-group-error">{err}</div>}
            <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5">
                {t("cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={title.trim().length < 3 || submitting}
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
  } = useMessengerActions();
  const [members, setMembers] = useState([]);
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

  const isAdmin = !!conversation?.group?.is_admin;
  const convId = conversation?.id;

  useEffect(() => {
    if (open && convId) {
      listGroupMembers(convId).then(setMembers).catch(() => {});
      setTitleDraft(conversation?.group?.title || "");
      setDescDraft(conversation?.group?.description || "");
      setError("");
    } else {
      setEditingTitle(false); setEditingDesc(false); setAddOpen(false); setAddQuery("");
    }
  }, [open, convId, listGroupMembers, conversation?.group?.title, conversation?.group?.description]);

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
  const refreshMembers = () => listGroupMembers(convId).then(setMembers).catch(() => {});
  const handleAdd = async (u) => {
    try { await addGroupMembers(convId, [u.id]); refreshMembers(); setAddQuery(""); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
  };
  const handleRemove = async (uid) => {
    try { await removeGroupMember(convId, uid); refreshMembers(); }
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

        <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto" data-testid="group-info-members-list">
          {members.map((m) => {
            const isMe = m.id === user?.id;
            return (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl group" data-testid={`group-info-member-${m.username}`}>
                <UserAvatar user={m} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{m.display_name || m.username}{isMe && <span className="text-[10px] text-white/55"> ({t("you").trim() || "you"})</span>}</div>
                  <div className="text-[10px] text-white/45 truncate">@{m.username}</div>
                </div>
                {m.is_admin && (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-md" style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "#C9B8FF" }} data-testid={`group-info-admin-badge-${m.username}`}>
                    <Crown className="inline w-2.5 h-2.5 mr-0.5" />{t("adminLabel")}
                  </span>
                )}
                {isAdmin && !isMe && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {m.is_admin ? (
                      <button onClick={() => handleDemote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`group-info-demote-${m.username}`}>{t("demote")}</button>
                    ) : (
                      <button onClick={() => handlePromote(m.id)} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10" data-testid={`group-info-promote-${m.username}`}>{t("promote")}</button>
                    )}
                    <button onClick={() => handleRemove(m.id)} className="p-1 rounded-md text-red-300 hover:bg-white/5" data-testid={`group-info-remove-${m.username}`}>
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="px-5 pb-2 text-xs text-red-300" data-testid="group-info-error">{error}</div>}

        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={handleLeave} className="w-full px-3 py-2 rounded-lg text-sm font-medium text-red-300 hover:bg-red-500/10 flex items-center justify-center gap-2" data-testid="group-info-leave">
            <LogOut className="w-4 h-4" /> {t("leaveGroup")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
