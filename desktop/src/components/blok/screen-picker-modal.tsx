import { useState, useEffect, useMemo } from "react";
import { X, Monitor, AppWindow, Volume2 } from "lucide-react";
import { useScreenPickerStore } from "@/lib/store/screen-picker-store";
import {
  useUiSettingsStore,
  type ScreenShareFps,
  type ScreenShareResolution,
  type ScreenShareQuality,
} from "@/lib/store/ui-settings-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Source picker for the native (Linux/X11) screen-share fallback. Shown when the
 * browser has no getDisplayMedia portal, so we roll our own "whole screen / window"
 * chooser plus a desktop-audio toggle. Mounted once at app root; driven entirely by
 * useScreenPickerStore (the voice engine calls requestPick() and awaits the choice).
 */
export function ScreenPickerModal() {
  const { t } = useI18n();
  const { open, sources, initialAudio, confirm, cancel } = useScreenPickerStore();
  const { screenShareFps, screenShareResolution, screenShareQuality, screenShareAudio, setSetting } =
    useUiSettingsStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(false);

  // Reset the local selection each time the picker opens (default: first source).
  // The audio box starts from the remembered setting rather than always off: a
  // mid-share source switch passes the live state as `initialAudio`, and a fresh
  // share falls back to whatever the user ticked last time — it used to reset to
  // unchecked on every single share.
  useEffect(() => {
    if (open) {
      setSelected(sources[0]?.id ?? null);
      setWithAudio(initialAudio ?? screenShareAudio);
    }
    // screenShareAudio is read only at open time; re-running on its change would
    // fight the user mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sources, initialAudio]);

  const screens = useMemo(() => sources.filter((s) => s.kind === "screen"), [sources]);
  const windows = useMemo(() => sources.filter((s) => s.kind === "window"), [sources]);

  if (!open) return null;

  const start = () => {
    if (!selected) return;
    // Remember the choice so the next share opens with the same box ticked.
    setSetting("screenShareAudio", withAudio);
    confirm({ sourceId: selected, withAudio });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center font-mono">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={cancel} />

      <div className="relative w-full max-w-lg max-h-[80vh] bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl animate-fade-in flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            <span className="text-[var(--text-muted)] mr-1">$</span>{t("screenPicker.title")}
          </h2>
          <button
            onClick={cancel}
            className="p-1.5 hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {sources.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] py-6 text-center">
              {t("screenPicker.noSources")}
            </p>
          )}

          {screens.length > 0 && (
            <div className="space-y-2">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                <span className="mr-1">&gt;</span>{t("screenPicker.screens")}
              </span>
              <div className="space-y-1.5">
                {screens.map((s) => (
                  <SourceRow
                    key={s.id}
                    icon={<Monitor className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />}
                    name={s.name}
                    selected={selected === s.id}
                    onClick={() => setSelected(s.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {windows.length > 0 && (
            <div className="space-y-2">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                <span className="mr-1">&gt;</span>{t("screenPicker.windows")}
              </span>
              <div className="space-y-1.5">
                {windows.map((s) => (
                  <SourceRow
                    key={s.id}
                    icon={<AppWindow className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />}
                    name={s.name}
                    selected={selected === s.id}
                    onClick={() => setSelected(s.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] p-5 space-y-4">
          {/* Quality controls write straight to the settings store — the capture
              reads them at start, and they double as the persisted defaults. */}
          <div className="flex items-center gap-3">
            <label className="flex-1">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
                <span className="mr-1">&gt;</span>{t("screenPicker.resolution")}
              </span>
              <select
                value={screenShareResolution}
                onChange={(e) => setSetting("screenShareResolution", e.target.value as ScreenShareResolution)}
                className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-1.5 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="native">Native</option>
              </select>
            </label>
            <label className="flex-1">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
                <span className="mr-1">&gt;</span>{t("screenPicker.frameRate")}
              </span>
              <select
                value={screenShareFps}
                onChange={(e) => setSetting("screenShareFps", Number(e.target.value) as ScreenShareFps)}
                className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-1.5 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
              >
                <option value={15}>15 FPS</option>
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </label>
            <label className="flex-1">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
                <span className="mr-1">&gt;</span>{t("screenPicker.quality")}
              </span>
              <select
                value={screenShareQuality}
                onChange={(e) => setSetting("screenShareQuality", e.target.value as ScreenShareQuality)}
                className="w-full bg-[var(--bg-base)] border-b border-[var(--border)] text-sm text-[var(--text-primary)] font-mono py-1.5 focus:outline-none focus:border-[var(--text-primary)] transition-colors"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <Volume2 className="w-4 h-4 text-[var(--text-muted)]" />
              {t("screenPicker.shareAudio")}
            </span>
            <input
              type="checkbox"
              checked={withAudio}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              className="btn-terminal text-xs px-4 py-2"
            >
              {t("screenPicker.cancel")}
            </button>
            <button
              type="button"
              onClick={start}
              disabled={!selected}
              className="btn-terminal text-xs px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed border-[var(--text-primary)]"
            >
              {t("screenPicker.start")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  icon,
  name,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 border text-left transition-colors",
        selected
          ? "bg-[var(--bg-elevated)] border-[var(--text-primary)]"
          : "border-[var(--border)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {icon}
      <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{name}</span>
      <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text-muted)] flex items-center justify-center flex-shrink-0">
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />}
      </span>
    </button>
  );
}
