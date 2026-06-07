import { useState } from "react";
import { X, UserPlus, Search, Check, AlertCircle, Copy, RefreshCw, Link, Clock, Users } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface InviteUserModalProps {
 isOpen: boolean;
 onClose: () => void;
 serverId: string;
 serverName: string;
}

type Tab = "username" | "code";
type ExpiryOption = "1d" | "7d" | "never";
type UsesOption = "1" | "5" | "10" | "unlimited";

const USES_LABELS: Record<UsesOption, string> = { "1": "1", "5": "5", "10": "10", unlimited: "∞" };

function expiresAtFromOption(opt: ExpiryOption): string | null {
 if (opt === "never") return null;
 const d = new Date();
 d.setDate(d.getDate() + (opt === "7d" ? 7 : 1));
 return d.toISOString();
}

function maxUsesFromOption(opt: UsesOption): number | null {
 return opt === "unlimited" ? null : parseInt(opt, 10);
}

export function InviteUserModal({ isOpen, onClose, serverId, serverName }: InviteUserModalProps) {
 const { inviteUser, generateInviteCode, servers } = useServerStore();
 const { t } = useI18n();
 const expiryLabels: Record<ExpiryOption, string> = {
   "1d": t("invite.expiry.oneDay"),
   "7d": t("invite.expiry.sevenDays"),
   never: "∞",
 };
 const [tab, setTab] = useState<Tab>("username");
 const [username, setUsername] = useState("");
 const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
 const [message, setMessage] = useState("");
 const [copied, setCopied] = useState(false);
 const [generating, setGenerating] = useState(false);
 const [expiryOpt, setExpiryOpt] = useState<ExpiryOption>("7d");
 const [usesOpt, setUsesOpt] = useState<UsesOption>("unlimited");

 const server = servers.find((s) => s.id === serverId);
 const inviteCode = server?.inviteCode ?? null;

 if (!isOpen) return null;

 const handleInvite = async () => {
 if (!username.trim()) return;
 setStatus("loading");
 setMessage("");
 const error = await inviteUser(serverId, username);
 if (error) {
 setStatus("error");
 setMessage(error);
 } else {
 setStatus("success");
 setMessage(t("invite.addedToServer").replace("{username}", username.trim()));
 setUsername("");
 }
 };

 const handleCopy = () => {
 if (!inviteCode) return;
 void navigator.clipboard.writeText(inviteCode);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 const handleGenerate = async () => {
 setGenerating(true);
 await generateInviteCode(serverId, {
 expiresAt: expiresAtFromOption(expiryOpt),
 maxUses: maxUsesFromOption(usesOpt),
 });
 setGenerating(false);
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Enter") handleInvite();
 if (e.key === "Escape") onClose();
 };

 const handleClose = () => {
 setUsername("");
 setStatus("idle");
 setMessage("");
 onClose();
 };

 const isExpired =
 server?.inviteExpiresAt != null && new Date(server.inviteExpiresAt) < new Date();
 const isExhausted =
 server?.inviteMaxUses != null && (server.inviteUsedCount ?? 0) >= server.inviteMaxUses;

 const expiryLabel = (() => {
 if (!inviteCode) return null;
 if (isExpired) return t("invite.codeExpired");
 if (!server?.inviteExpiresAt) return null;
 const diff = new Date(server.inviteExpiresAt).getTime() - Date.now();
 const days = Math.ceil(diff / 86_400_000);
 return t("invite.expiresInDays").replace("{days}", String(days));
 })();

 const usesLabel =
 server?.inviteMaxUses != null
 ? t("invite.usesCount")
     .replace("{used}", String(server.inviteUsedCount ?? 0))
     .replace("{max}", String(server.inviteMaxUses))
 : null;

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
 <div className="w-[400px] bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl animate-fade-in">
 <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
 <div className="flex items-center gap-2">
 <UserPlus className="w-4 h-4 text-[var(--accent-red)]" />
 <span className="font-semibold text-sm text-[var(--text-primary)]">
 {t("invite.addMember")}
 </span>
 </div>
 <button
 onClick={handleClose}
 className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
 >
 <X className="w-4 h-4 text-[var(--text-muted)]" />
 </button>
 </div>

 <div className="flex border-b border-[var(--border)]">
 <button
 onClick={() => setTab("username")}
 className={cn(
 "flex-1 px-4 py-2 text-xs font-medium transition-colors",
 tab === "username"
 ? "text-[var(--text-primary)] border-b-2 border-[var(--accent-red)]"
 : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
 )}
 >
 {t("invite.byUsername")}
 </button>
 <button
 onClick={() => setTab("code")}
 className={cn(
 "flex-1 px-4 py-2 text-xs font-medium transition-colors",
 tab === "code"
 ? "text-[var(--text-primary)] border-b-2 border-[var(--accent-red)]"
 : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
 )}
 >
 {t("invite.byCode")}
 </button>
 </div>

 <div className="px-4 py-4 space-y-4">
 <p className="text-xs text-[var(--text-muted)]">
 <span className="opacity-60">$ server </span>
 <span className="text-[var(--text-primary)]">{serverName}</span>
 </p>

 {tab === "username" ? (
 <>
 <div className="space-y-2">
 <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
 Username
 </label>
 <div className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2">
 <Search className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
 <input
 autoFocus
 type="text"
 value={username}
 onChange={(e) => {
 setUsername(e.target.value);
 if (status !== "idle") { setStatus("idle"); setMessage(""); }
 }}
 onKeyDown={handleKeyDown}
 placeholder={t("addFriend.enterUsername")}
 className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
 />
 </div>
 </div>

 {message && (
 <div className={cn(
 "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
 status === "success"
 ? "bg-[var(--online)]/10 border border-[var(--online)]/30 text-[var(--online)]"
 : "bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 text-[var(--destructive)]"
 )}>
 {status === "success"
 ? <Check className="w-3 h-3 flex-shrink-0" />
 : <AlertCircle className="w-3 h-3 flex-shrink-0" />
 }
 {message}
 </div>
 )}

 <div className="flex gap-2 pt-1">
 <button
 onClick={handleClose}
 className="flex-1 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
 >
 {t("roles.cancel")}
 </button>
 <button
 onClick={handleInvite}
 disabled={!username.trim() || status === "loading"}
 className={cn(
 "flex-1 px-3 py-2 text-sm rounded-lg transition-colors font-medium",
 username.trim() && status !== "loading"
 ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
 : "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed"
 )}
 >
 {status === "loading" ? t("invite.adding") : t("invite.addUser")}
 </button>
 </div>
 </>
 ) : (
 <>
 <div className="space-y-2">
 <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
 <Link className="w-3 h-3" /> {t("invite.code")}
 </label>
 {inviteCode ? (
 <div className="space-y-1.5">
 <div className={cn(
 "flex items-center gap-2 bg-[var(--bg-elevated)] border rounded-lg px-3 py-2.5",
 (isExpired || isExhausted) ? "border-[var(--destructive)]/40" : "border-[var(--border)]"
 )}>
 <span className={cn(
 "flex-1 font-mono text-sm tracking-widest",
 (isExpired || isExhausted) ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"
 )}>
 {inviteCode}
 </span>
 {!isExpired && !isExhausted && (
 <button
 onClick={handleCopy}
 className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
 >
 {copied
 ? <><Check className="w-3.5 h-3.5 text-[var(--online)]" /><span className="text-[var(--online)]">{t("invite.copied")}</span></>
 : <><Copy className="w-3.5 h-3.5" /><span>{t("invite.copy")}</span></>
 }
 </button>
 )}
 </div>
 {(expiryLabel || usesLabel) && (
 <div className="flex items-center gap-3 px-1">
 {expiryLabel && (
 <span className={cn(
 "flex items-center gap-1 text-[10px]",
 isExpired ? "text-[var(--destructive)]" : "text-[var(--text-muted)]"
 )}>
 <Clock className="w-3 h-3" /> {expiryLabel}
 </span>
 )}
 {usesLabel && (
 <span className={cn(
 "flex items-center gap-1 text-[10px]",
 isExhausted ? "text-[var(--destructive)]" : "text-[var(--text-muted)]"
 )}>
 <Users className="w-3 h-3" /> {usesLabel}
 </span>
 )}
 </div>
 )}
 </div>
 ) : (
 <p className="text-xs text-[var(--text-muted)] px-1">{t("invite.noCode")}</p>
 )}
 </div>

 {/* TTL selector */}
 <div className="space-y-1.5">
 <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] uppercase tracking-wider">
 <Clock className="w-3 h-3" /> {t("invite.expiry")}
 </label>
 <div className="flex gap-1.5">
 {(["1d", "7d", "never"] as ExpiryOption[]).map((opt) => (
 <button
 key={opt}
 onClick={() => setExpiryOpt(opt)}
 className={cn(
 "flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors",
 expiryOpt === opt
 ? "bg-[var(--accent-red)]/15 border-[var(--accent-red)]/50 text-[var(--accent-red)]"
 : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
 )}
 >
 {expiryLabels[opt]}
 </button>
 ))}
 </div>
 </div>

 {/* Max uses selector */}
 <div className="space-y-1.5">
 <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] uppercase tracking-wider">
 <Users className="w-3 h-3" /> {t("invite.maxUses")}
 </label>
 <div className="flex gap-1.5">
 {(["1", "5", "10", "unlimited"] as UsesOption[]).map((opt) => (
 <button
 key={opt}
 onClick={() => setUsesOpt(opt)}
 className={cn(
 "flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors",
 usesOpt === opt
 ? "bg-[var(--accent-red)]/15 border-[var(--accent-red)]/50 text-[var(--accent-red)]"
 : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
 )}
 >
 {USES_LABELS[opt]}
 </button>
 ))}
 </div>
 </div>

 <button
 onClick={handleGenerate}
 disabled={generating}
 className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] border border-[var(--border)] rounded-lg transition-colors disabled:opacity-50"
 >
 <RefreshCw className={cn("w-3.5 h-3.5", generating && "animate-spin")} />
 {generating ? t("invite.generating") : t("invite.generate")}
 </button>

 <button
 onClick={handleClose}
 className="w-full px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
 >
 {t("invite.close")}
 </button>
 </>
 )}
 </div>
 </div>
 </div>
 );
}
