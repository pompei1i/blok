import { cn } from "@/lib/utils";
import type { User } from "@/lib/store/types";

interface AvatarProps {
  user?: User | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showRing?: boolean;
  isSpeaking?: boolean;
}

export function UserAvatar({
  user,
  size = "md",
  className,
  showRing,
  isSpeaking,
}: AvatarProps) {
  const sizeClasses = {
    xs: "w-5 h-5 text-[10px]",
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
    xl: "w-16 h-16 text-xl",
  } as const;

  const initial = user?.username?.charAt(0).toUpperCase() || "?";

  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] font-medium text-[var(--text-primary)]",
        sizeClasses[size],
        showRing && "ring-2 ring-[var(--accent-red)]",
        isSpeaking && "speaking-glow ring-2 ring-[var(--online)]",
        className,
      )}
    >
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.username}
          className="w-full h-full object-cover rounded-full"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

