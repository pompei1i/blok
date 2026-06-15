// Shared moderation helpers: slowmode / timeout presets and duration formatting.
// Kept framework-agnostic so it's trivially unit-testable.

/** Slowmode cooldown presets in seconds (0 = off). Mirrors the 6h cap in the RPC. */
export const SLOWMODE_PRESETS = [0, 5, 10, 30, 60, 300, 900, 3600, 21600] as const;

/** Timeout presets in minutes (0 = clear the timeout). */
export const TIMEOUT_PRESETS_MIN = [5, 10, 60, 1440] as const;

/** Short label for a slowmode interval, e.g. 0→"off", 45→"45s", 300→"5m", 3600→"1h". */
export function formatSlowmode(seconds: number): string {
  if (seconds <= 0) return "off";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** Human countdown for a number of seconds, e.g. 5→"5s", 75→"1m 15s", 3700→"1h 1m". */
export function formatDurationSeconds(total: number): string {
  if (total <= 0) return "0s";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Label for a timeout preset, e.g. 5→"5m", 60→"1h", 1440→"1d". */
export function formatTimeoutPreset(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}
