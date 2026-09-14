import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatInput } from "@/hooks/useChatInput";
import { ChannelPerm } from "@/lib/permission";
import type { User } from "@/lib/store/types";

// A mutable store stand-in so each case can set up its own server/role/overrides.
const storeState: Record<string, unknown> = {};
vi.mock("@/lib/store/server-store", () => ({
  useServerStore: () => storeState,
}));

const user: User = {
  id: "u1",
  username: "u",
  email: "u@example.com",
  createdAt: "2024-01-01T00:00:00Z",
};

/** Populates the store as a member of s1 holding `roleId`, with `overrides`. */
function setup(opts: {
  roleId?: string | null;
  overrides?: { channelId: string; roleId: string | null; allow: number; deny: number }[];
  ownerId?: string;
  withServer?: boolean;
}) {
  const { roleId = "r1", overrides = [], ownerId = "someone-else", withServer = true } = opts;
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    addMessage: vi.fn().mockResolvedValue(undefined),
    activeServerId: "s1",
    servers: withServer ? [{ id: "s1", ownerId, name: "s", createdAt: "" }] : [],
    channelIndex: { "ch-1": { id: "ch-1", serverId: "s1", name: "updates", type: "text", position: 0, slowModeSeconds: 0 } },
    members: { s1: [{ id: "m1", userId: "u1", serverId: "s1", roleId: roleId ?? undefined }] },
    roles: { s1: [{ id: "r1", serverId: "s1", name: "member", permissions: 0, position: 0, isDefault: true, createdAt: "" }] },
    channelOverrides: overrides,
  });
}

beforeEach(() => {
  setup({});
});

describe("read-only channels", () => {
  it("is writable when no override applies", () => {
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(false);
  });

  // The announcements case: @everyone may read but not post.
  it("locks the composer when @everyone is denied send", () => {
    setup({ overrides: [{ channelId: "ch-1", roleId: null, allow: 0, deny: ChannelPerm.SEND }] });
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.canSend).toBe(false);
  });

  it("leaves it open for a role that is explicitly allowed", () => {
    setup({
      overrides: [
        { channelId: "ch-1", roleId: null, allow: 0, deny: ChannelPerm.SEND },
        { channelId: "ch-1", roleId: "r1", allow: ChannelPerm.SEND, deny: 0 },
      ],
    });
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(false);
  });

  it("never locks out the server owner", () => {
    setup({
      ownerId: "u1",
      overrides: [{ channelId: "ch-1", roleId: null, allow: 0, deny: ChannelPerm.SEND }],
    });
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(false);
  });

  it("ignores an override aimed at another channel", () => {
    setup({ overrides: [{ channelId: "ch-other", roleId: null, allow: 0, deny: ChannelPerm.SEND }] });
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(false);
  });
});

describe("contexts with no server", () => {
  // A resolver with no server to reason about denies by default. Applying that
  // here would have locked the composer on the first render after boot and in
  // DMs, where there is no server at all — so the gate only engages once the
  // server is resolved.
  it("stays writable when the server is not in the store yet", () => {
    setup({
      withServer: false,
      overrides: [{ channelId: "ch-1", roleId: null, allow: 0, deny: ChannelPerm.SEND }],
    });
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user }));
    expect(result.current.isReadOnly).toBe(false);
  });

  it("stays writable with no active channel", () => {
    const { result } = renderHook(() => useChatInput({ activeChannelId: null, user }));
    expect(result.current.isReadOnly).toBe(false);
  });
});
