import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function OfflineBanner() {
  const { t } = useI18n();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-[var(--destructive)] text-white text-xs font-mono z-50">
      <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t("offline.noConnection")}</span>
    </div>
  );
}
