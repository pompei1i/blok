import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "../../lib/store/auth-store";
import { useI18n } from "@/lib/i18n";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const { login, register, isLoading, error, clearError } = useAuthStore();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("login");

  // NOTE: the auth screen no longer force-resizes the OS window — doing so
  // clobbered the user's chosen / maximized window size on every login/logout.
  // The card is centered, so it sits comfortably in whatever window exists.

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
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-[var(--text-primary)] tracking-widest mb-2">
              BLOK
            </h1>
            <p className="text-[var(--text-muted)] text-sm font-mono">
              ~/auth {mode === "login" ? "login" : "register"}
              <span className="cursor-blink ml-1">_</span>
            </p>
          </div>

          {/* Card */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)]">
            {/* Terminal title bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 bg-[var(--destructive)]" />
                <div className="w-3 h-3 bg-[var(--afk)]" />
                <div className="w-3 h-3 bg-[var(--online)]" />
              </div>
              <span className="text-xs text-[var(--text-muted)] font-mono ml-2">
                blok@auth:~$ {mode === "login" ? "./login.sh" : "./register.sh"}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="text-sm text-[var(--text-muted)] font-mono border-l-2 border-[var(--border)] pl-3 mb-6">
                <span className="text-[var(--text-primary)]">$</span>{" "}
                {mode === "login"
                  ? t("auth.welcomeBack")
                  : t("auth.createAccountPrompt")}
              </div>

              {mode === "register" && (
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                    <span className="text-[var(--text-muted)]">&gt;</span>
                    {t("auth.username")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm pointer-events-none">
                      @
                    </span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your_username"
                      className="input-terminal pl-4"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                  <span className="text-[var(--text-muted)]">&gt;</span>
                  {t("auth.email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-terminal"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                  <span className="text-[var(--text-muted)]">&gt;</span>
                  {t("auth.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-terminal pr-16"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xs font-mono"
                  >
                    {showPassword ? "[hide]" : "[show]"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <div className="space-y-1">
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium flex items-center gap-1">
                    <span className="text-[var(--text-muted)]">&gt;</span>
                    {t("auth.confirmPassword")}
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-terminal"
                    required
                  />
                </div>
              )}

              {displayError && (
                <p className="prefix-error text-sm text-[var(--destructive)] font-mono">
                  {displayError}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="btn-terminal prefix-dollar w-full py-3 font-semibold uppercase tracking-widest border-[var(--text-primary)]/60 mt-2"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {mode === "login" ? t("auth.authenticating") : t("auth.creatingAccount")}
                  </span>
                ) : (
                  mode === "login" ? t("auth.login") : t("auth.register")
                )}
              </button>

              {mode === "login" && (
                <p className="text-xs text-[var(--text-muted)] font-mono border-l border-[var(--border)] pl-3">
                  <span className="text-[var(--online)]">tip:</span> use demo@blok.app / demo123
                </p>
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
