import { useState, useEffect } from "react";
import { X, Hash, Volume2 } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  initialType?: "text" | "voice";
}

export function CreateChannelModal({
  isOpen,
  onClose,
  serverId,
  initialType = "text",
}: CreateChannelModalProps) {
  const { createChannel } = useServerStore();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">(initialType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when opened with new initialType
  useEffect(() => {
    if (isOpen) {
      setType(initialType);
      setName("");
      setError(null);
    }
  }, [isOpen, initialType]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await createChannel({
        serverId,
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create channel");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl animate-fade-in flex flex-col overflow-hidden">
        <div className="p-6 text-center space-y-2 border-b border-[var(--border)]">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("createChannel.title")}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            {t("createChannel.subtitle")}
          </p>
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-[var(--text-muted)]"
        >
          <X className="w-5 h-5" />
        </button>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-[var(--destructive)]/20 border border-[var(--destructive)]/30 rounded-lg text-[var(--destructive)] text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {t("createChannel.channelType")}
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setType("text")}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  type === "text"
                    ? "bg-[var(--bg-elevated)] border-[var(--text-primary)]"
                    : "border-[var(--border)] hover:bg-[var(--bg-hover)]",
                )}
              >
                <Hash className="w-5 h-5 text-[var(--text-muted)]" />
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t("createChannel.textType")}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t("createChannel.textTypeDesc")}</p>
                </div>
                <div className="ml-auto w-4 h-4 rounded-full border-2 border-[var(--text-muted)] flex items-center justify-center">
                  {type === "text" && <div className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType("voice")}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  type === "voice"
                    ? "bg-[var(--bg-elevated)] border-[var(--text-primary)]"
                    : "border-[var(--border)] hover:bg-[var(--bg-hover)]",
                )}
              >
                <Volume2 className="w-5 h-5 text-[var(--text-muted)]" />
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t("createChannel.voiceType")}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t("createChannel.voiceTypeDesc")}</p>
                </div>
                <div className="ml-auto w-4 h-4 rounded-full border-2 border-[var(--text-muted)] flex items-center justify-center">
                  {type === "voice" && <div className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />}
                </div>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {t("createChannel.channelName")}
            </label>
            <div className="relative">
              {type === "text" ? (
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              ) : (
                <Volume2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="new-channel"
                className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-red)] transition-colors"
                maxLength={100}
                autoFocus
              />
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="w-full py-2.5 bg-[var(--accent-red)] text-white rounded-lg hover:opacity-90 font-medium transition-opacity disabled:opacity-50"
            >
              {isSubmitting ? t("createChannel.creating") : t("createChannel.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
