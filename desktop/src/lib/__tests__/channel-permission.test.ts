import { describe, it, expect } from "vitest";
import { canInChannel, ChannelPerm, Perm, type ChannelOverride } from "../permission";
import type { Server, Role } from "../store/types";

const server = { id: "s1", ownerId: "owner" } as Server;
const role = (permissions: number, id = "r1"): Role =>
  ({ id, serverId: "s1", name: "role", permissions, position: 0, isDefault: false, createdAt: "" });

const everyone = (allow: number, deny: number, channelId = "c1"): ChannelOverride =>
  ({ channelId, roleId: null, allow, deny });
const forRole = (roleId: string, allow: number, deny: number, channelId = "c1"): ChannelOverride =>
  ({ channelId, roleId, allow, deny });

describe("default access", () => {
  it("allows everything when no override exists", () => {
    const ctx = { userId: "u1", server, role: role(0) };
    expect(canInChannel("view", "c1", ctx)).toBe(true);
    expect(canInChannel("send", "c1", ctx)).toBe(true);
    expect(canInChannel("connect", "c1", ctx)).toBe(true);
  });

  it("denies everyone who is not signed in or not in a server", () => {
    expect(canInChannel("view", "c1", { userId: null, server })).toBe(false);
    expect(canInChannel("view", "c1", { userId: "u1", server: null })).toBe(false);
  });
});

describe("@everyone baseline", () => {
  // The announcements case from the feature request: everybody reads, nobody
  // writes except the roles explicitly allowed below.
  it("denies send while leaving view intact", () => {
    const ctx = {
      userId: "u1",
      server,
      role: role(0),
      overrides: [everyone(0, ChannelPerm.SEND)],
    };
    expect(canInChannel("view", "c1", ctx)).toBe(true);
    expect(canInChannel("send", "c1", ctx)).toBe(false);
  });

  it("applies to members with no role at all", () => {
    const ctx = { userId: "u1", server, role: null, overrides: [everyone(0, ChannelPerm.SEND)] };
    expect(canInChannel("send", "c1", ctx)).toBe(false);
  });

  it("hides a channel outright when view is denied", () => {
    const ctx = { userId: "u1", server, role: role(0), overrides: [everyone(0, ChannelPerm.VIEW)] };
    expect(canInChannel("view", "c1", ctx)).toBe(false);
  });
});

describe("role overrides beat the baseline", () => {
  it("re-allows send for the staff role", () => {
    const ctx = {
      userId: "u1",
      server,
      role: role(0, "staff"),
      overrides: [everyone(0, ChannelPerm.SEND), forRole("staff", ChannelPerm.SEND, 0)],
    };
    expect(canInChannel("send", "c1", ctx)).toBe(true);
  });

  it("leaves other roles denied", () => {
    const ctx = {
      userId: "u1",
      server,
      role: role(0, "member"),
      overrides: [everyone(0, ChannelPerm.SEND), forRole("staff", ChannelPerm.SEND, 0)],
    };
    expect(canInChannel("send", "c1", ctx)).toBe(false);
  });

  it("can deny a single role something everyone else may do", () => {
    const ctx = {
      userId: "u1",
      server,
      role: role(0, "muted"),
      overrides: [forRole("muted", 0, ChannelPerm.CONNECT)],
    };
    expect(canInChannel("connect", "c1", ctx)).toBe(false);
    expect(canInChannel("view", "c1", ctx)).toBe(true);
  });
});

describe("voice access by role", () => {
  // The second case from the request: a voice channel only some roles may join.
  const overrides = [everyone(0, ChannelPerm.CONNECT), forRole("vip", ChannelPerm.CONNECT, 0)];

  it("lets the allowed role connect", () => {
    expect(canInChannel("connect", "c1", { userId: "u1", server, role: role(0, "vip"), overrides })).toBe(true);
  });

  it("keeps everyone else out", () => {
    expect(canInChannel("connect", "c1", { userId: "u1", server, role: role(0, "plebs"), overrides })).toBe(false);
  });

  it("still lets them see the channel exists", () => {
    expect(canInChannel("view", "c1", { userId: "u1", server, role: role(0, "plebs"), overrides })).toBe(true);
  });
});

describe("administrator bypass", () => {
  const locked = [everyone(0, ChannelPerm.VIEW | ChannelPerm.SEND | ChannelPerm.CONNECT)];

  it("never locks out the server owner", () => {
    const ctx = { userId: "owner", server, role: role(0), overrides: locked };
    expect(canInChannel("view", "c1", ctx)).toBe(true);
    expect(canInChannel("send", "c1", ctx)).toBe(true);
  });

  it("never locks out MANAGE_SERVER", () => {
    const ctx = { userId: "u1", server, role: role(Perm.MANAGE_SERVER), overrides: locked };
    expect(canInChannel("view", "c1", ctx)).toBe(true);
    expect(canInChannel("send", "c1", ctx)).toBe(true);
  });

  it("does not extend the bypass to other management permissions", () => {
    const ctx = { userId: "u1", server, role: role(Perm.KICK_MEMBER), overrides: locked };
    expect(canInChannel("send", "c1", ctx)).toBe(false);
  });
});

describe("override scoping", () => {
  it("ignores overrides belonging to a different channel", () => {
    const ctx = {
      userId: "u1",
      server,
      role: role(0),
      overrides: [everyone(0, ChannelPerm.SEND, "other-channel")],
    };
    expect(canInChannel("send", "c1", ctx)).toBe(true);
  });

  it("treats allow as winning over deny within one row", () => {
    // Both bits set is a malformed row; allow is applied last so the outcome is
    // predictable rather than depending on evaluation order.
    const ctx = {
      userId: "u1",
      server,
      role: role(0),
      overrides: [everyone(ChannelPerm.SEND, ChannelPerm.SEND)],
    };
    expect(canInChannel("send", "c1", ctx)).toBe(true);
  });
});
