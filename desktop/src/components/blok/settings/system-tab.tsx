import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useUpdater } from "@/hooks/useUpdater";
import { SectionHeader } from "./section-header";

/** OS integration: autostart + updater status. */
export function SystemTab() {
  const { t } = useI18n();
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const { available: updateAvailable, version: updateVersion, installing: updateInstalling, installUpdate } = useUpdater();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setAppVersion)).catch(() => {});
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("autostart_is_enabled").then(setLaunchOnStartup).catch(() => {});
    });
  }, []);

  return (
    <div className="max-w-2xl animate-fade-in space-y-5">
      <SectionHeader title={t("settings.system.title")} subtitle={t("settings.system.subtitle")} />
      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-5">
        <label className="flex items-center justify-between gap-6">
          <div>
            <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.system.launchOnStartup")}</span>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{t("settings.system.launchOnStartupHint")}</p>
          </div>
          <input
            type="checkbox"
            checked={launchOnStartup}
            disabled={!("__TAURI_INTERNALS__" in window)}
            onChange={(e) => {
              const next = e.target.checked;
              setLaunchOnStartup(next);
              import("@tauri-apps/api/core").then(({ invoke }) => {
                invoke("autostart_set", { enabled: next }).catch(() => {
                  setLaunchOnStartup(!next);
                });
              });
            }}
          />
        </label>
      </div>

      <div className="p-4 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
        <span className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          <span className="mr-1">&gt;</span>{t("settings.system.updates")}
        </span>
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-[var(--text-primary)] font-mono">{t("settings.system.currentVersion")}</span>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
              {appVersion ? `v${appVersion}` : "—"}
            </p>
          </div>
          {updateAvailable ? (
            <button
              onClick={installUpdate}
              disabled={updateInstalling}
              className="btn-terminal prefix-dollar text-xs px-3 py-1.5 font-semibold disabled:opacity-50"
            >
              {updateInstalling ? t("settings.system.installingUpdate") : `${t("settings.system.installUpdate")} v${updateVersion}`}
            </button>
          ) : (
            <span className="text-xs text-[var(--online-text)] font-mono">[✓] {t("settings.system.upToDate")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
