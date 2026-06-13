import { useState, useRef, useEffect } from "react";
import { X, Plus, Minus, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface PollCreatorParams {
  question: string;
  options: string[];
  isMultipleChoice: boolean;
  isAnonymous: boolean;
}

interface PollCreatorProps {
  onClose: () => void;
  onSubmit: (params: PollCreatorParams) => Promise<void>;
}

export function PollCreator({ onClose, onSubmit }: PollCreatorProps) {
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [isMultipleChoice, setIsMultipleChoice] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const questionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  const addOption = () => {
    if (options.length < 10) setOptions((prev) => [...prev, ""]);
  };

  const removeOption = (i: number) => {
    if (options.length > 2) setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateOption = (i: number, value: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };

  const canSubmit =
    !isSubmitting &&
    question.trim().length > 0 &&
    options.filter((o) => o.trim().length > 0).length >= 2;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        question: question.trim(),
        options: options.filter((o) => o.trim().length > 0).map((o) => o.trim()),
        isMultipleChoice,
        isAnonymous,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-surface)]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="w-4 h-4 text-[var(--accent-red)] flex-shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)]">{t("poll.title")}</span>
        <button
          onClick={onClose}
          className="ml-auto p-0.5 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Question */}
      <input
        ref={questionRef}
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t("poll.questionPlaceholder")}
        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-red)] transition-colors mb-2"
        maxLength={280}
      />

      {/* Options */}
      <div className="flex flex-col gap-1.5 mb-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[12px] text-[var(--text-muted)] w-4 text-right flex-shrink-0">{i + 1}</span>
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`${t("poll.option")} ${i + 1}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addOption(); }
              }}
              className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-red)] transition-colors"
              maxLength={120}
            />
            {options.length > 2 && (
              <button
                onClick={() => removeOption(i)}
                className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors flex-shrink-0"
              >
                <Minus className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button
            onClick={addOption}
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors pl-5 mt-0.5"
          >
            <Plus className="w-3 h-3" />
            {t("poll.addOption")}
          </button>
        )}
      </div>

      {/* Toggles + actions row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Single / Multiple */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMultipleChoice(false)}
            className={cn(
              "text-[12px] px-2 py-1 rounded border transition-colors",
              !isMultipleChoice
                ? "border-[var(--accent-red)] bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]",
            )}
          >
            {t("poll.singleChoice")}
          </button>
          <button
            onClick={() => setIsMultipleChoice(true)}
            className={cn(
              "text-[12px] px-2 py-1 rounded border transition-colors",
              isMultipleChoice
                ? "border-[var(--accent-red)] bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]",
            )}
          >
            {t("poll.multipleChoice")}
          </button>
        </div>

        {/* Open / Anonymous */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAnonymous(false)}
            className={cn(
              "text-[12px] px-2 py-1 rounded border transition-colors",
              !isAnonymous
                ? "border-[var(--accent-red)] bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]",
            )}
          >
            {t("poll.openVotes")}
          </button>
          <button
            onClick={() => setIsAnonymous(true)}
            className={cn(
              "text-[12px] px-2 py-1 rounded border transition-colors",
              isAnonymous
                ? "border-[var(--accent-red)] bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]",
            )}
          >
            {t("poll.anonymous")}
          </button>
        </div>

        {/* Submit */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className={cn(
              "text-xs px-3 py-1 rounded transition-colors",
              canSubmit
                ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                : "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed",
            )}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              </span>
            ) : (
              t("poll.create")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
