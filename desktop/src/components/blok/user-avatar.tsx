import type { CSSProperties } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarFrameStyle } from "@/lib/economy";
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
    xs: "w-5 h-5 text-[12px]",
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
    xl: "w-16 h-16 text-xl",
  } as const;

  const initial = user?.username?.charAt(0).toUpperCase() || "?";

  // Equipped avatar frame (cosmetic).
  const frame = avatarFrameStyle(user);
  const frameStyle: CSSProperties | undefined =
    frame?.ring
      ? { boxShadow: frame.effect ? `0 0 0 2px ${frame.ring}, 0 0 8px ${frame.ring}` : `0 0 0 2px ${frame.ring}` }
      : undefined;

  return (
    <div
      style={frameStyle}
      className={cn(
        "relative flex items-center justify-center rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] font-medium text-[var(--text-primary)]",
        sizeClasses[size],
        showRing && !frameStyle && "ring-2 ring-[var(--accent-red)]",
        className,
      )}
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.username} className="w-full h-full object-cover rounded-full" />
      ) : (
        <span>{initial}</span>
      )}
      {/* Speaking indicator: cheap dark overlay + centered loudspeaker (no GPU
          blur filter — an animated blur here janked the compositor during calls). */}
      {isSpeaking && (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
          <Volume2 className="w-1/2 h-1/2 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
        </span>
      )}
    </div>
  );
}

