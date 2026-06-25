import { useState } from "react";
import { X, Server as ServerIcon, Loader2 } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface CreateServerModalProps {
 onClose: () => void;
}

export function CreateServerModal({ onClose }: CreateServerModalProps) {
 const { user } = useAuthStore();
 const { createServer } = useServerStore();
 const { t } = useI18n();
 
 const [name, setName] = useState("");
 const [description, setDescription] = useState("");
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!name.trim() || !user) return;

 setIsSubmitting(true);
 setError(null);

 try {
 await createServer({
 name: name.trim(),
 description: description.trim() || undefined
 });
 onClose();
 } catch (err: any) {
 setError(err.message || "Failed to create server");
 setIsSubmitting(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
 <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden animate-slide-up">
 <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center border border-[var(--border)]">
 <ServerIcon className="w-4 h-4 text-[var(--text-primary)]" />
 </div>
 <h2 className="font-semibold text-[var(--text-primary)]">
 {t("createServer.title")}
 </h2>
 </div>
 <button
 onClick={onClose}
 className="p-1 hover:bg-[var(--bg-hover)] rounded-md transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
 {error && (
 <div className="p-3 bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 rounded-lg text-xs text-[var(--destructive)]">
 {error}
 </div>
 )}

 <div className="flex flex-col gap-1.5">
 <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 {t("createServer.serverName")} <span className="text-[var(--accent-red)]">*</span>
 </label>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder={t("createServer.serverNamePlaceholder")}
 maxLength={100}
 autoFocus
 className="px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors placeholder:text-[var(--text-muted)]/50"
 required
 />
 </div>

 <div className="flex flex-col gap-1.5">
 <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
 {t("createServer.description")} <span className="text-[var(--text-muted)] opacity-70">{t("createServer.descriptionOptional")}</span>
 </label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder={t("createServer.descriptionPlaceholder")}
 maxLength={255}
 rows={3}
 className="px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-red)] transition-colors resize-none placeholder:text-[var(--text-muted)]/50"
 />
 </div>

 <div className="flex justify-end pt-2 mt-2 border-t border-[var(--border)] gap-2">
 <button
 type="button"
 onClick={onClose}
 className="px-4 py-2 hover:bg-[var(--bg-hover)] rounded-lg text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
 disabled={isSubmitting}
 >
 {t("createServer.cancel")}
 </button>
 <button
 type="submit"
 disabled={!name.trim() || isSubmitting}
 className={cn(
 "px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
 name.trim() && !isSubmitting
 ? "bg-[var(--accent-red)] text-white hover:opacity-90 shadow-lg hover:shadow-[var(--accent-red)]/20"
 : "bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed"
 )}
 >
 {isSubmitting ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" /> {t("createServer.creating")}
 </>
 ) : (
 t("createServer.create")
 )}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
}
