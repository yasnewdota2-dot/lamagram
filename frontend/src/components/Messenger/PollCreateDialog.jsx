import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { useI18n } from "../../lib/i18n";
import { useMessengerActions } from "../../lib/messenger";
import { toast } from "sonner";

const MAX_Q = 300;
const MAX_OPT = 100;
const MAX_OPTS = 10;
const MIN_OPTS = 2;

export const PollCreateDialog = ({ open, onOpenChange, conversationId }) => {
  const { t } = useI18n();
  const { createPoll } = useMessengerActions();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [isAnon, setIsAnon] = useState(false);
  const [allowsMulti, setAllowsMulti] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setIsAnon(false);
    setAllowsMulti(false);
    setSubmitting(false);
  };

  const setOpt = (i, v) => {
    setOptions((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  };
  const addOpt = () => {
    if (options.length >= MAX_OPTS) return;
    setOptions((arr) => [...arr, ""]);
  };
  const removeOpt = (i) => {
    if (options.length <= MIN_OPTS) return;
    setOptions((arr) => arr.filter((_, idx) => idx !== i));
  };

  const cleanOptions = options.map((s) => s.trim()).filter((s) => s.length > 0);
  const hasDupes = new Set(cleanOptions).size !== cleanOptions.length;
  const canSubmit =
    question.trim().length > 0 &&
    cleanOptions.length >= MIN_OPTS &&
    !hasDupes &&
    !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createPoll(conversationId, {
        question: question.trim(),
        options: cleanOptions,
        is_anonymous: isAnon,
        allows_multiple: allowsMulti,
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join("\n")
        : typeof detail === "string"
        ? detail
        : t("createPollError") || "Could not create poll";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]" data-testid="poll-create-dialog">
        <DialogHeader>
          <DialogTitle data-testid="poll-create-title">
            {t("poll.create.title") || "Create poll"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="block text-sm mb-1 opacity-80">
              {t("poll.create.question_label") || "Question"}
            </label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, MAX_Q))}
              placeholder={t("poll.create.question_label") || "Ask something..."}
              rows={2}
              maxLength={MAX_Q}
              dir="auto"
              data-testid="poll-create-question"
            />
            <div className="text-xs opacity-50 text-end mt-1">
              {question.length} / {MAX_Q}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-2 opacity-80">
              {t("poll.create.options_label") || "Options"}
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    onChange={(e) => setOpt(i, e.target.value.slice(0, MAX_OPT))}
                    placeholder={`${t("poll.create.options_label") || "Option"} ${i + 1}`}
                    maxLength={MAX_OPT}
                    dir="auto"
                    data-testid={`poll-create-option-${i}`}
                  />
                  {options.length > MIN_OPTS && (
                    <button
                      type="button"
                      onClick={() => removeOpt(i)}
                      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/10 transition"
                      aria-label="remove option"
                      data-testid={`poll-create-remove-option-${i}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTS && (
              <button
                type="button"
                onClick={addOpt}
                className="mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full opacity-80 hover:opacity-100 transition"
                style={{ background: "var(--bg-glass-soft, rgba(255,255,255,0.05))", border: "1px solid var(--border-glass, rgba(255,255,255,0.1))" }}
                data-testid="poll-create-add-option"
              >
                <Plus className="w-4 h-4" />
                {t("poll.create.add_option") || "Add option"}
              </button>
            )}
            {hasDupes && (
              <div className="text-xs text-red-400 mt-2" data-testid="poll-create-dupes-warning">
                {t("poll.create.duplicates") || "Duplicate options are not allowed"}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between py-1">
            <label className="text-sm">{t("poll.create.anonymous") || "Anonymous votes"}</label>
            <Switch checked={isAnon} onCheckedChange={setIsAnon} data-testid="poll-create-anonymous" />
          </div>
          <div className="flex items-center justify-between py-1">
            <label className="text-sm">{t("poll.create.multiple") || "Multiple answers"}</label>
            <Switch checked={allowsMulti} onCheckedChange={setAllowsMulti} data-testid="poll-create-multiple" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} data-testid="poll-create-cancel">
            {t("poll.create.cancel") || "Cancel"}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit} data-testid="poll-create-submit">
            {submitting ? "…" : (t("poll.create.submit") || "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PollCreateDialog;
