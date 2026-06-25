import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useServerStore } from "@/lib/store/server-store";

export type VoiceUserCtx = { userId: string; name: string; x: number; y: number };

/**
 * Right-click context menu for another participant in a voice channel:
 * per-user volume (0–200%) and a local-only mute. Shared between the channel
 * sidebar participant list and the voice room tiles.
 */
export function VoiceUserContextMenu({
  ctx,
  onClose,
}: {
  ctx: VoiceUserCtx;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { userVolumes, setUserVolume, locallyMuted, setLocalMute } = useServerStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 9999 }}
      className="w-52 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl py-2 px-3 space-y-3"
    >
      <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">{ctx.name}</p>

      {/* Volume slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-muted)]">{t("voice.ctx.volume")}</span>
          <span className="text-[11px] font-mono text-[var(--text-primary)]">
            {userVolumes[ctx.userId] ?? 100}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={userVolumes[ctx.userId] ?? 100}
          onChange={(e) => setUserVolume(ctx.userId, Number(e.target.value))}
          className="w-full h-1 accent-[var(--online)] cursor-pointer"
        />
        <div className="flex justify-between text-[9px] text-[var(--text-muted)] opacity-50">
          <span>0</span><span>100</span><span>200</span>
        </div>
      </div>

      {/* Local mute toggle */}
      <button
        onClick={() => {
          setLocalMute(ctx.userId, !locallyMuted[ctx.userId]);
          onClose();
        }}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-[12px] transition-colors",
          locallyMuted[ctx.userId]
            ? "bg-[var(--destructive)] bg-opacity-15 text-[var(--destructive)] hover:bg-opacity-25"
            : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)]",
        )}
      >
        <VolumeX className="w-3.5 h-3.5 flex-shrink-0" />
        {locallyMuted[ctx.userId] ? t("voice.ctx.unmute") : t("voice.ctx.mute")}
      </button>
    </div>,
    document.body,
  );
}
