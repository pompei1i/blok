import { cn } from "@/lib/utils";
import type { PresenceStatus } from "@/lib/store/types";

interface PresenceDotProps {
  status: PresenceStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const PX = { sm: 8, md: 10, lg: 12 } as const;

// Fill colors. offline now uses its own token (was wrongly sharing --destructive
// with dnd, making the two statuses visually identical).
const COLOR: Record<PresenceStatus, string> = {
  online: "var(--online)",
  offline: "var(--offline)",
  afk: "var(--afk)",
  dnd: "var(--destructive)",
};

// Optional glow (kept from the previous design) for "live" statuses only.
const GLOW: Partial<Record<PresenceStatus, string>> = {
  online: "presence-online",
  afk: "presence-afk",
};

const LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  offline: "Offline",
  afk: "Away",
  dnd: "Do not disturb",
};

/**
 * Status is conveyed by SHAPE as well as color (WCAG 1.4.1), so it survives
 * color-blindness and distinguishes dnd from offline:
 *   online  ● full disc
 *   offline ○ hollow ring
 *   dnd     ⊝ disc with a bar
 *   afk     ◐ crescent
 * Cutouts use --bg-surface to match the ring most placements already draw.
 */
export function PresenceDot({ status, size = "md", className }: PresenceDotProps) {
  const px = PX[size];
  const color = COLOR[status];

  return (
    <span
      role="img"
      aria-label={LABEL[status]}
      className={cn("inline-flex rounded-full", GLOW[status], className)}
      style={{ width: px, height: px }}
    >
      <svg viewBox="0 0 8 8" width={px} height={px} fill={color} aria-hidden="true">
        {status === "online" && <circle cx="4" cy="4" r="4" />}

        {status === "offline" && (
          <circle cx="4" cy="4" r="3" fill="none" stroke={color} strokeWidth="2" />
        )}

        {status === "dnd" && (
          <>
            <circle cx="4" cy="4" r="4" />
            <rect x="1.5" y="3" width="5" height="2" rx="1" fill="var(--bg-surface)" />
          </>
        )}

        {status === "afk" && (
          <>
            <circle cx="4" cy="4" r="4" />
            <circle cx="2.2" cy="2.2" r="3" fill="var(--bg-surface)" />
          </>
        )}
      </svg>
    </span>
  );
}
