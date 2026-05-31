import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart3, Lock, Check, Reply, Trash2, Forward, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import { useMessengerActions } from "../../lib/messenger";
import { useLongPress } from "../../lib/useLongPress";
import { AvatarStack } from "./AvatarStack";

// Telegram-style poll bubble.
// - Single mode: tap option → instant vote.
// - Multi mode: select N options → click "Vote" → submit.
// - Closed: options disabled, "Final results" label.
// - Anonymous: hide "View results" for non-creator/non-admin.
export const PollMessage = ({
  message,
  mine,
  conversation,
  groupMembers,
  onReply,
  onForward,
  onDelete,
}) => {
  const { t } = useI18n();
  const { user: meUser } = useAuth();
  const { votePoll, closePoll } = useMessengerActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [voting, setVoting] = useState(false);
  const [pendingMulti, setPendingMulti] = useState([]);
  const [showResults, setShowResults] = useState(false);

  const poll = message.poll || {};
  const options = poll.options || [];
  const isClosed = !!poll.closed;
  const isAnon = !!poll.is_anonymous;
  const isMulti = !!poll.allows_multiple;
  const totalVoters = poll.total_voters || 0;
  const myVotes = poll.my_votes || [];
  const hasVoted = myVotes.length > 0;

  const meId = meUser?.id;
  const isCreator = message.sender_id === meId;
  const isAdmin =
    (conversation?.kind === "group" || conversation?.kind === "channel") &&
    !!conversation?.group?.is_admin;
  const canSeeVoters = !isAnon || isCreator || isAdmin;
  const canClose = (isCreator || isAdmin) && !isClosed;

  // Reset pendingMulti when message changes or vote refreshed
  useEffect(() => {
    setPendingMulti(myVotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const lp = useLongPress(() => setMenuOpen(true), { threshold: 500 });
  const { didFire, ...lpHandlers } = lp;

  const handleSingleTap = async (optionId) => {
    if (isClosed || voting) return;
    setVoting(true);
    try {
      await votePoll(message.id, [optionId]);
    } catch (_e) {
      /* WS will sync; ignore transient error */
    } finally {
      setVoting(false);
    }
  };

  const toggleMulti = (optionId) => {
    if (isClosed) return;
    setPendingMulti((arr) =>
      arr.includes(optionId) ? arr.filter((x) => x !== optionId) : [...arr, optionId]
    );
  };

  const submitMulti = async () => {
    if (isClosed || voting || pendingMulti.length === 0) return;
    setVoting(true);
    try {
      await votePoll(message.id, pendingMulti);
    } catch (_e) {} finally {
      setVoting(false);
    }
  };

  const handleClose = async () => {
    try {
      await closePoll(message.id);
    } catch (_e) {}
  };

  // For multi: dirty when pending differs from myVotes
  const multiDirty =
    isMulti &&
    (pendingMulti.length !== myVotes.length ||
      pendingMulti.some((x) => !myVotes.includes(x)));

  const headerLabel = isClosed
    ? (t("poll.final") || "Final results")
    : isAnon
    ? (t("poll.anonymous") || "Anonymous Poll")
    : (t("poll.label") || "Poll");

  const bubbleSide = mine ? "self-end" : "self-start";
  const bubbleBg = mine ? "var(--bubble-mine-bg)" : "var(--bubble-theirs-bg)";
  const bubbleText = mine ? "var(--bubble-mine-text)" : "var(--bubble-theirs-text)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col ${bubbleSide} max-w-[420px] w-fit`}
      data-testid={`message-${message.id}`}
    >
      <div
        className="rounded-2xl px-3.5 py-3 shadow-sm select-none"
        style={{ background: bubbleBg, color: bubbleText, minWidth: 280 }}
        data-testid={`poll-bubble-${message.id}`}
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <div
              {...lpHandlers}
              onClick={(e) => {
                // Phase 25 Bug 5: short-tap on header must NOT open menu.
                // Only long-press (via useLongPress) opens menu by setting state directly.
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="cursor-default"
              data-testid={`poll-header-area-${message.id}`}
            >
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide opacity-70 mb-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                <span data-testid="poll-header-label">{headerLabel}</span>
                {isAnon && <Lock className="w-3 h-3 opacity-60" />}
              </div>
              <div className="font-medium text-[15px] leading-snug mb-2.5" data-testid="poll-question">
                {poll.question}
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"} data-testid={`poll-menu-${message.id}`}>
            <DropdownMenuItem onClick={() => { onReply?.(message); setMenuOpen(false); }} data-testid="poll-action-reply">
              <Reply className="w-4 h-4 me-2" /> {t("reply") || "Reply"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { onForward?.(message); setMenuOpen(false); }} data-testid="poll-action-forward">
              <Forward className="w-4 h-4 me-2" /> {t("forward") || "Forward"}
            </DropdownMenuItem>
            {canClose && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { handleClose(); setMenuOpen(false); }} data-testid="poll-action-close">
                  <Lock className="w-4 h-4 me-2" /> {t("poll.close") || "Close poll"}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { onDelete?.(message, mine ? "all" : "me"); setMenuOpen(false); }}
              className="text-red-400 focus:text-red-300"
              data-testid="poll-action-delete"
            >
              <Trash2 className="w-4 h-4 me-2" /> {t("delete") || "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="space-y-1.5">
          {options.map((opt) => {
            const pct = totalVoters > 0 ? Math.round((opt.vote_count / totalVoters) * 100) : 0;
            const selected = isMulti
              ? pendingMulti.includes(opt.id)
              : opt.voted;
            const showCheck = opt.voted;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMulti) toggleMulti(opt.id);
                  else handleSingleTap(opt.id);
                }}
                disabled={isClosed || voting}
                className="relative w-full text-start rounded-xl px-3 py-2 transition-colors group"
                style={{
                  background: "var(--poll-opt-bg, rgba(255,255,255,0.06))",
                  border: `1px solid ${selected ? "var(--accent, #3B9EFF)" : "var(--border-glass, rgba(255,255,255,0.08))"}`,
                  cursor: isClosed ? "default" : "pointer",
                }}
                data-testid={`poll-option-${opt.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 relative z-10">
                  <div className="flex items-center gap-2 min-w-0">
                    {isMulti ? (
                      <span
                        className="w-4 h-4 rounded shrink-0 flex items-center justify-center"
                        style={{
                          border: `1.5px solid ${selected ? "var(--accent, #3B9EFF)" : "currentColor"}`,
                          background: selected ? "var(--accent, #3B9EFF)" : "transparent",
                          opacity: selected ? 1 : 0.5,
                        }}
                      >
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </span>
                    ) : (
                      <span
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{
                          border: `1.5px solid ${showCheck ? "var(--accent, #3B9EFF)" : "currentColor"}`,
                          background: showCheck ? "var(--accent, #3B9EFF)" : "transparent",
                          opacity: showCheck ? 1 : 0.5,
                        }}
                      />
                    )}
                    <span className="truncate text-sm">{opt.text}</span>
                  </div>
                  <span
                    key={opt.vote_count}
                    className="text-xs font-medium opacity-80 shrink-0 gm-vote-pulse cursor-pointer"
                    onClick={(e) => {
                      // Phase 25b — tap % opens View results dialog (non-anon polls only)
                      if (!canSeeVoters || !hasVoted) return;
                      e.stopPropagation();
                      e.preventDefault();
                      setShowResults(true);
                    }}
                    data-testid={`poll-option-pct-${opt.id}`}
                  >
                    {pct}%
                  </span>
                </div>
                {/* Progress bar */}
                <div
                  className="h-1 rounded-full overflow-hidden relative z-10"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: "var(--accent, #3B9EFF)",
                      transition: "width 500ms cubic-bezier(0.4, 0, 0.2, 1)",
                      willChange: "width",
                    }}
                    data-testid={`poll-option-bar-${opt.id}`}
                  />
                </div>
                {!isAnon && (opt.votes?.length || 0) > 0 && (
                  <div
                    className="mt-1.5 relative z-10"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`poll-option-voters-${opt.id}`}
                  >
                    <AvatarStack ids={opt.votes} max={3} size={18} testId={`poll-option-avatars-${opt.id}`} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer: voters count + actions */}
        <div className="flex items-center justify-between mt-2.5 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <span className="text-xs opacity-70" data-testid="poll-voters-count">
            {totalVoters === 0
              ? (t("poll.noVoters") || "No votes yet")
              : `${totalVoters} ${totalVoters === 1 ? (t("poll.voter") || "voter") : (t("poll.voters") || "voters")}`}
          </span>
          <div className="flex items-center gap-2">
            {isMulti && multiDirty && !isClosed && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); submitMulti(); }}
                disabled={voting}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: "var(--accent, #3B9EFF)", color: "#fff" }}
                data-testid="poll-submit-vote"
              >
                {t("poll.vote") || "Vote"}
              </button>
            )}
            {canSeeVoters && hasVoted && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowResults(true); }}
                className="text-xs opacity-80 hover:opacity-100"
                data-testid="poll-view-results"
              >
                {t("poll.viewResults") || "View results"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* View results dialog (non-anonymous OR creator/admin only) */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-[400px]" data-testid="poll-results-dialog">
          <DialogHeader>
            <DialogTitle>{poll.question}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[420px] overflow-y-auto">
            {options.map((opt) => {
              const votes = opt.votes || [];
              return (
                <div key={opt.id}>
                  <div className="text-sm font-medium mb-1.5">{opt.text} <span className="opacity-50">· {opt.vote_count}</span></div>
                  <div className="space-y-1">
                    {votes.length === 0 && (
                      <div className="text-xs opacity-50 ps-2">— {t("poll.noVoters") || "No votes"} —</div>
                    )}
                    {votes.map((uid) => {
                      const m = groupMembers?.[uid];
                      const name = uid === meUser?.id
                        ? meUser?.display_name || meUser?.username
                        : m?.display_name || m?.username || `User ${uid.slice(0, 6)}`;
                      return (
                        <div key={uid} className="text-xs opacity-80 ps-2" data-testid={`poll-results-voter-${opt.id}-${uid}`}>
                          {name}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setShowResults(false)} data-testid="poll-results-close">
              <X className="w-4 h-4 me-1" /> {t("close") || "Close"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default PollMessage;
