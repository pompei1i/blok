import { useState, useEffect } from "react";
import { Eye, EyeOff, Terminal, ChevronRight, Loader2 } from "lucide-react";
import { useAuthStore } from "../../lib/store/auth-store";
import { cn } from "../../lib/utils";
import { useI18n } from "@/lib/i18n";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const { login, register, isLoading, error, clearError } = useAuthStore();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
      void getCurrentWindow().setSize(new LogicalSize(480, 580));
    });
    return () => {
      if (!("__TAURI_INTERNALS__" in window)) return;
      void import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
        void getCurrentWindow().setSize(new LogicalSize(800, 600));
      });
    };
  }, []);
  const [showPassword, setShowPassword] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    clearError();

    if (mode === "register") {
      if (password !== confirmPassword) {
        setLocalError(t("auth.passwordMismatch"));
        return;
      }
      if (password.length < 6) {
        setLocalError(t("auth.passwordMin"));
        return;
      }
      if (username.length < 3) {
        setLocalError(t("auth.usernameMin"));
        return;
      }
      await register(username, email, password);
    } else {
      await login(email, password);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setLocalError("");
    clearError();
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 bottom-0 w-48 terminal-grid opacity-30" />
        <div className="absolute right-0 top-0 bottom-0 w-48 terminal-grid opacity-30" />
      </div>

      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-4 border-2 border-[var(--border)] rounded-lg bg-[var(--bg-surface)]">
              <Terminal className="w-8 h-8 text-[var(--text-primary)]" />
            </div>
            <h1 className="text-4xl font-bold text-[var(--text-primary)] tracking-tight mb-2">
              BLOK
            </h1>
            <p className="text-[var(--text-muted)] text-sm font-mono">
              ~/auth {mode === "login" ? "login" : "register"}
              <span className="cursor-blink ml-1">_</span>
            </p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[var(--destructive)]" />
                <div className="w-3 h-3 rounded-full bg-[var(--afk)]" />
                <div className="w-3 h-3 rounded-full bg-[var(--online)]" />
              </div>
              <span className="text-xs text-[var(--text-muted)] font-mono ml-2">
                blok@auth:~$ {mode === "login" ? "./login.sh" : "./register.sh"}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="text-sm text-[var(--text-muted)] font-mono border-l-2 border-[var(--border)] pl-3 mb-6">
                <span className="text-[var(--text-primary)]">$</span>{" "}
                {mode === "login"
                  ? t("auth.welcomeBack")
                  : t("auth.createAccountPrompt")}
              </div>

              {mode === "register" && (
                <div className="space-y-2">
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
                    {t("auth.username")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                      @
                    </span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your_username"
                      className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 pl-8 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors font-mono text-sm"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
                  {t("auth.email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors font-mono text-sm"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
                  {t("auth.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 pr-10 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors font-mono text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <div className="space-y-2">
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
                    {t("auth.confirmPassword")}
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors font-mono text-sm"
                    required
                  />
                </div>
              )}

              {displayError && (
                <div className="p-3 bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded-lg">
                  <p className="text-sm text-[var(--destructive)] font-mono">
                    <span className="opacity-60">error:</span> {displayError}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all",
                  "bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {mode === "login" ? t("auth.authenticating") : t("auth.creatingAccount")}
                    </span>
                  </>
                ) : (
                  <>
                    <span>{mode === "login" ? t("auth.login") : t("auth.register")}</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {mode === "login" && (
                <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]">
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    <span className="text-[var(--online)]">tip:</span> use demo@blok.app /
                    demo123
                  </p>
                </div>
              )}
            </form>

            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
              <p className="text-sm text-center text-[var(--text-muted)]">
                {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-[var(--text-primary)] hover:underline font-medium"
                >
                  {mode === "login" ? t("auth.register") : t("auth.login")}
                </button>
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-[var(--text-muted)] mt-6 font-mono">
            {t("auth.byContinuing")}
          </p>
        </div>
      </div>
    </div>
  );
}

