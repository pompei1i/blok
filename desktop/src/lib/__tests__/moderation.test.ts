import { describe, it, expect } from "vitest";
import {
  SLOWMODE_PRESETS,
  TIMEOUT_PRESETS_MIN,
  formatSlowmode,
  formatDurationSeconds,
  formatTimeoutPreset,
} from "../moderation";
import { Perm, can } from "../permission";
import type { Server, Role } from "../store/types";

// ── Formatting helpers ────────────────────────────────────────────────────────

describe("formatSlowmode", () => {
  it("renders off / seconds / minutes / hours", () => {
    expect(formatSlowmode(0)).toBe("off");
    expect(formatSlowmode(-5)).toBe("off");
    expect(formatSlowmode(5)).toBe("5s");
    expect(formatSlowmode(59)).toBe("59s");
    expect(formatSlowmode(60)).toBe("1m");
    expect(formatSlowmode(300)).toBe("5m");
    expect(formatSlowmode(3600)).toBe("1h");
    expect(formatSlowmode(21600)).toBe("6h");
  });
});

describe("formatDurationSeconds", () => {
  it("renders compact h/m/s countdowns", () => {
    expect(formatDurationSeconds(0)).toBe("0s");
    expect(formatDurationSeconds(5)).toBe("5s");
    expect(formatDurationSeconds(75)).toBe("1m 15s");
    expect(formatDurationSeconds(3700)).toBe("1h 1m");
  });
});

describe("formatTimeoutPreset", () => {
  it("renders minutes / hours / days", () => {
    expect(formatTimeoutPreset(5)).toBe("5m");
    expect(formatTimeoutPreset(60)).toBe("1h");
    expect(formatTimeoutPreset(1440)).toBe("1d");
  });
});

describe("presets", () => {
  it("slowmode presets start with off and stay within the 6h cap", () => {
    expect(SLOWMODE_PRESETS[0]).toBe(0);
    expect(Math.max(...SLOWMODE_PRESETS)).toBe(21600);
  });
  it("timeout presets are positive minutes", () => {
    expect(TIMEOUT_PRESETS_MIN.every((m) => m > 0)).toBe(true);
  });
});

// ── Permission bits ───────────────────────────────────────────────────────────

const server: Server = { id: "s1", ownerId: "owner", name: "S", createdAt: "" };

function roleWith(bits: number): Role {
  return { id: "r1", serverId: "s1", name: "mod", permissions: bits, position: 1, isDefault: false, createdAt: "" };
}

describe("moderation permissions", () => {
  it("new perm bits are distinct powers of two", () => {
    expect(Perm.BAN_MEMBER).toBe(1024);
    expect(Perm.MODERATE_MEMBERS).toBe(2048);
    expect(Perm.MANAGE_CHANNELS).toBe(4096);
  });

  it("owner bypasses all moderation checks", () => {
    const ctx = { userId: "owner", server, role: null };
    expect(can("ban_member", ctx)).toBe(true);
    expect(can("moderate_members", ctx)).toBe(true);
    expect(can("manage_channels", ctx)).toBe(true);
  });

  it("a member needs the matching role bit", () => {
    const banner = { userId: "u1", server, role: roleWith(Perm.BAN_MEMBER) };
    expect(can("ban_member", banner)).toBe(true);
    expect(can("moderate_members", banner)).toBe(false);
    expect(can("manage_channels", banner)).toBe(false);
  });

  it("a member with no role cannot moderate", () => {
    const ctx = { userId: "u1", server, role: null };
    expect(can("ban_member", ctx)).toBe(false);
    expect(can("moderate_members", ctx)).toBe(false);
    expect(can("manage_channels", ctx)).toBe(false);
  });
});
