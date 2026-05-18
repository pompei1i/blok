import { Monitor, AppWindow, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ScreenSource {
  id: string;
  name: string;
}

interface WindowSource {
  id: string;
  title: string;
}

interface ScreenSharePickerProps {
  onSelect: (sourceId: string) => void;
  onClose: () => void;
}

function SourceRow({
  id,
  label,
  icon: Icon,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  icon: typeof Monitor;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-left transition-colors border",
        selected
          ? "bg-[var(--online)]/15 border-[var(--online)]/40 text-[var(--text-primary)]"
          : "border-transparent hover:bg-[var(--bg-hover)] text-[var(--text-muted)]",
      )}
    >
      <Icon
        className={cn("w-3.5 h-3.5 flex-shrink-0", selected ? "text-[var(--online)]" : "text-[var(--text-muted)]")}
      />
      <p className="text-xs truncate flex-1">{label}</p>
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-[var(--online)] flex-shrink-0" />}
    </button>
  );
}

export function ScreenSharePicker({ onSelect, onClose }: ScreenSharePickerProps) {
  const [screens, setScreens] = useState<ScreenSource[]>([]);
  const [windows, setWindows] = useState<WindowSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      invoke<ScreenSource[]>("get_screen_sources").catch(() => []),
      invoke<WindowSource[]>("get_window_sources").catch(() => []),
    ]).then(([srcs, wins]) => {
      setScreens(srcs);
      setWindows(wins);
      setSelected(srcs[0]?.id ?? wins[0]?.id ?? null);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="absolute bottom-full left-0 mb-2 w-68 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-50"
      style={{ width: "17rem" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          <span className="text-[var(--online)] mr-1">$</span>select source
        </span>
        <button
          onClick={onClose}
          className="p-0.5 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="overflow-y-auto max-h-60 p-1.5 space-y-0.5">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 text-[var(--text-muted)] animate-spin" />
          </div>
        ) : (
          <>
            {screens.length > 0 && (
              <>
                <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider px-2 pt-1 pb-0.5 opacity-60">
                  Monitors
                </p>
                {screens.map((s) => (
                  <SourceRow key={s.id} id={s.id} label={s.name} icon={Monitor} selected={selected === s.id} onSelect={setSelected} />
                ))}
              </>
            )}

            {windows.length > 0 && (
              <>
                <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider px-2 pt-2 pb-0.5 opacity-60">
                  Windows
                </p>
                {windows.map((w) => (
                  <SourceRow key={w.id} id={w.id} label={w.title} icon={AppWindow} selected={selected === w.id} onSelect={setSelected} />
                ))}
              </>
            )}

            {!loading && screens.length === 0 && windows.length === 0 && (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">No sources found</p>
            )}
          </>
        )}
      </div>

      <div className="px-1.5 pb-1.5 pt-1 border-t border-[var(--border)]">
        <button
          disabled={!selected || loading}
          onClick={() => selected && onSelect(selected)}
          className="w-full py-1.5 bg-[var(--online)] hover:opacity-90 disabled:opacity-50 text-white text-xs font-mono rounded transition-opacity"
        >
          start sharing
        </button>
      </div>
    </div>
  );
}
