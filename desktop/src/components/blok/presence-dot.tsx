import { cn } from "@/lib/utils";
import type { PresenceStatus } from "@/lib/store/types";

interface PresenceDotProps {
  status: PresenceStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PresenceDot({
  status,
  size = "md",
  className,
}: PresenceDotProps) {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-2.5 h-2.5",
    lg: "w-3 h-3",
  } as const;

  const statusClasses = {
    online: "bg-[var(--online)] presence-online",
    offline: "bg-[var(--destructive)]",
    afk: "bg-[var(--afk)] presence-afk",
    dnd: "bg-[var(--destructive)]",
  } as const;

  return (
    <span
      className={cn(
        "inline-block rounded-full",
        sizeClasses[size],
        statusClasses[status],
        className,
      )}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  );
}

