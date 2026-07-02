import { useState } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./section-header";

/** Password change — has its own submit, so no shared Apply bar. */
export function SecurityTab() {
  const { changePassword } = useAuthStore();
  const { t } = useI18n();

  const [pwd, setPwd] = useState({ next: "", confirm: "" });
  const [isChangingPwd, setIsChangingPwd] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    if (pwd.next.length < 8) {
      setPwdMessage({ type: "error", text: t("settings.account.passwordTooShort") });
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdMessage({ type: "error", text: t("settings.account.passwordMismatch") });
      return;
    }
    setIsChangingPwd(true);
    const res = await changePassword(pwd.next);
    setIsChangingPwd(false);
    if (res.success) {
      setPwd({ next: "", confirm: "" });
      setPwdMessage({ type: "success", text: t("settings.account.passwordChanged") });
      setTimeout(() => setPwdMessage(null), 3000);
    } else {
      setPwdMessage({ type: "error", text: res.message ?? t("settings.account.saveError") });
    }
  };

  return (
    <div className="max-w-2xl animate-fade-in">
      <div className="mb-6">
        <SectionHeader title={t("settings.account.changePassword")} subtitle={t("settings.security.subtitle")} />
      </div>

      <form onSubmit={handleChangePassword} className="p-5 bg-[var(--bg-surface)] border border-dashed border-[var(--border)] space-y-4">
        <div>
          <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.account.newPassword")}
          </label>
          <input
            type="password"
            value={pwd.next}
            onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
            className="input-terminal"
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            <span className="mr-1">&gt;</span>{t("settings.account.confirmPassword")}
          </label>
          <input
            type="password"
            value={pwd.confirm}
            onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
            className="input-terminal"
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
        {pwdMessage && (
          <p className={cn(
            "text-sm font-mono animate-fade-in",
            pwdMessage.type === "success" ? "text-[var(--online-text)]" : "text-[var(--accent-red-text)]",
          )}>
            {pwdMessage.type === "success" ? "[✓] " : "[!] "}{pwdMessage.text}
          </p>
        )}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={isChangingPwd || !pwd.next || !pwd.confirm}
            className="btn-terminal prefix-dollar px-5 py-2 text-xs font-semibold uppercase tracking-widest disabled:opacity-50"
          >
            {isChangingPwd ? t("settings.account.saving") : t("settings.account.changePassword")}
          </button>
        </div>
      </form>
    </div>
  );
}
