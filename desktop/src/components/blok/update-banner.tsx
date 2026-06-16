import { useUpdater } from "../../hooks/useUpdater";
import { useI18n } from "@/lib/i18n";

export function UpdateBanner() {
  const { t } = useI18n();
  const { installing, error, version, installUpdate } = useUpdater();

  // Updates install automatically; the banner only reports progress or an error.
  if (!installing && !error) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-[var(--accent-red)] text-white px-4 py-2 flex items-center justify-between font-mono text-sm">
      {error ? (
        <>
          <span className="text-red-200">{t("update.error")} {error}</span>
          <button
            onClick={installUpdate}
            className="bg-white text-[var(--accent-red)] px-3 py-0.5 rounded text-xs font-bold hover:bg-gray-100"
          >
            {t("update.install")}
          </button>
        </>
      ) : (
        <span>
          <span className="opacity-60 mr-2">$</span>
          {t("update.installing")}{version ? ` — v${version}` : ""}
        </span>
      )}
    </div>
  );
}
