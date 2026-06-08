// XP required to reach each level (index = level - 1)
const THRESHOLDS = [0, 100, 250, 500, 1000, 1750, 2750, 4000, 5500, 7500, 10000];

export function xpToLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < THRESHOLDS.length; i++) {
    if (xp >= THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  current: number;
  needed: number;
  percent: number;
  maxed: boolean;
}

export function levelProgress(xp: number): LevelProgress {
  const level = xpToLevel(xp);
  const min = THRESHOLDS[level - 1] ?? 0;
  const max = THRESHOLDS[level];
  if (max === undefined) {
    return { level, current: 0, needed: 0, percent: 100, maxed: true };
  }
  const current = xp - min;
  const needed = max - min;
  return { level, current, needed, percent: Math.round((current / needed) * 100), maxed: false };
}

export function levelColor(level: number): string {
  if (level >= 10) return "#f59e0b";
  if (level >= 7) return "#a855f7";
  if (level >= 4) return "#3b82f6";
  return "#6b7280";
}
