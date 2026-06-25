import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Channel, Category } from "../types";

const rpc = () => (globalThis as any).__mockSupabaseRpc as ReturnType<typeof vi.fn>;
const q = () => (globalThis as any).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

function makeChannel(id: string, overrides: Partial<Channel> = {}): Channel {
  return {
    id, serverId: "s-1", name: `ch-${id}`, type: "text",
    position: 0, isPrivate: false, slowModeSeconds: 0, createdAt: "2024-01-01",
    ...overrides,
  };
}

function makeCategory(id: string, position: number): Category {
  return { id, serverId: "s-1", name: `cat-${id}`, position, createdAt: "2024-01-01" };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc().mockResolvedValue({ data: null, error: null });
  useServerStore.setState({
    servers: [],
    activeServerId: "s-1",
    channels: {},
    channelIndex: {},
    categories: {},
  });
});

// ── createChannel: position is scoped per category, not per type ───────────────

describe("createChannel", () => {
  it("assigns the next position within the target category, mixing text and voice", async () => {
    useServerStore.setState({
      channels: {
        "s-1": [
          makeChannel("a", { type: "text", position: 0, categoryId: "cat-1" }),
          makeChannel("b", { type: "voice", position: 1, categoryId: "cat-1" }),
          makeChannel("c", { type: "text", position: 5, categoryId: undefined }), // different category
        ],
      },
    });

    await useServerStore.getState().createChannel({ serverId: "s-1", name: "new-ch", type: "voice", categoryId: "cat-1" });

    expect(q().insert).toHaveBeenCalledWith(
      expect.objectContaining({ server_id: "s-1", category_id: "cat-1", position: 2 }),
    );
  });

  it("starts at position 0 for an empty category", async () => {
    useServerStore.setState({ channels: { "s-1": [] } });

    await useServerStore.getState().createChannel({ serverId: "s-1", name: "first", type: "text" });

    expect(q().insert).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: null, position: 0 }),
    );
  });
});

// ── reorderChannels ──────────────────────────────────────────────────────────

describe("reorderChannels", () => {
  it("applies category/position changes to local state optimistically", async () => {
    useServerStore.setState({
      channels: {
        "s-1": [
          makeChannel("a", { position: 0 }),
          makeChannel("b", { position: 1 }),
        ],
      },
      channelIndex: {
        a: makeChannel("a", { position: 0 }),
        b: makeChannel("b", { position: 1 }),
      },
    });

    await useServerStore.getState().reorderChannels("s-1", [
      { id: "a", categoryId: null, position: 1 },
      { id: "b", categoryId: null, position: 0 },
    ]);

    const list = useServerStore.getState().channels["s-1"];
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    expect(useServerStore.getState().channelIndex["a"].position).toBe(1);
  });

  it("moves a channel into a different category", async () => {
    useServerStore.setState({
      channels: {
        "s-1": [
          makeChannel("a", { position: 0, categoryId: "cat-1" }),
        ],
      },
      channelIndex: { a: makeChannel("a", { position: 0, categoryId: "cat-1" }) },
    });

    await useServerStore.getState().reorderChannels("s-1", [
      { id: "a", categoryId: "cat-2", position: 0 },
    ]);

    expect(useServerStore.getState().channels["s-1"][0].categoryId).toBe("cat-2");
    expect(useServerStore.getState().channelIndex["a"].categoryId).toBe("cat-2");
  });

  it("sends category_id/position to the reorder_channels RPC", async () => {
    useServerStore.setState({
      channels: { "s-1": [makeChannel("a")] },
      channelIndex: { a: makeChannel("a") },
    });

    await useServerStore.getState().reorderChannels("s-1", [{ id: "a", categoryId: "cat-1", position: 3 }]);

    expect(rpc()).toHaveBeenCalledWith("reorder_channels", {
      p_server_id: "s-1",
      p_items: [{ id: "a", category_id: "cat-1", position: 3 }],
    });
  });
});

// ── reorderCategories ────────────────────────────────────────────────────────

describe("reorderCategories", () => {
  it("applies position changes to local state and sorts by position", async () => {
    useServerStore.setState({
      categories: { "s-1": [makeCategory("x", 0), makeCategory("y", 1)] },
    });

    await useServerStore.getState().reorderCategories("s-1", [
      { id: "x", position: 1 },
      { id: "y", position: 0 },
    ]);

    const list = useServerStore.getState().categories["s-1"];
    expect(list.map((c) => c.id)).toEqual(["y", "x"]);
  });
});

// ── renameCategory / deleteCategory ──────────────────────────────────────────

describe("renameCategory", () => {
  it("updates the category name after a successful RPC", async () => {
    useServerStore.setState({ categories: { "s-1": [makeCategory("x", 0)] } });

    await useServerStore.getState().renameCategory("x", "renamed");

    expect(useServerStore.getState().categories["s-1"][0].name).toBe("renamed");
  });

  it("does not update state when the RPC fails", async () => {
    rpc().mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    useServerStore.setState({ categories: { "s-1": [makeCategory("x", 0)] } });

    await useServerStore.getState().renameCategory("x", "renamed");

    expect(useServerStore.getState().categories["s-1"][0].name).toBe("cat-x");
  });
});

describe("deleteCategory", () => {
  it("removes the category and uncategorizes its channels", async () => {
    useServerStore.setState({
      categories: { "s-1": [makeCategory("x", 0)] },
      channels: { "s-1": [makeChannel("a", { categoryId: "x" }), makeChannel("b", { categoryId: "other" })] },
    });

    await useServerStore.getState().deleteCategory("x");

    expect(useServerStore.getState().categories["s-1"]).toHaveLength(0);
    const channels = useServerStore.getState().channels["s-1"];
    expect(channels.find((c) => c.id === "a")?.categoryId).toBeUndefined();
    expect(channels.find((c) => c.id === "b")?.categoryId).toBe("other");
  });
});
