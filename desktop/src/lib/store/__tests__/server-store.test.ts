import { describe, it, expect, beforeEach } from "vitest";
import { useServerStore } from "../server-store";
import type { Server, Channel, Message, ServerMember } from "../types";

function makeServer(id: string): Server {
  return { id, ownerId: "owner", name: `Server ${id}`, createdAt: "2024-01-01" };
}

function makeChannel(id: string, serverId: string, type: "text" | "voice" = "text"): Channel {
  return { id, serverId, name: `ch-${id}`, type, position: 0, isPrivate: false, createdAt: "2024-01-01" };
}

function makeMessage(id: string, channelId: string): Message {
  return {
    id,
    channelId,
    authorId: "u1",
    content: "hello",
    isEdited: false,
    isPinned: false,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    attachments: [],
    reactions: [],
  };
}

function makeMember(userId: string, serverId: string): ServerMember {
  return {
    id: `mem-${userId}`,
    serverId,
    userId,
    joinedAt: "2024-01-01",
  };
}

beforeEach(() => {
  useServerStore.setState({
    servers: [],
    activeServerId: null,
    activeChannelId: null,
    categories: {},
    channels: {},
    members: {},
    messages: {},
    messagesLoaded: new Set(),
    messagesLoading: new Set(),
    typingUsers: {},
    openTabs: [],
    unreadCounts: {},
    activeVoiceChannelId: null,
    voiceParticipants: {},
    isMuted: false,
    isDeafened: false,
    isScreenSharing: false,
    screenShareUserId: null,
    remoteScreenStream: null,
  });
});

// ── setActiveServer ───────────────────────────────────────────────────────────

describe("setActiveServer", () => {
  it("sets the active server", () => {
    useServerStore.setState({ servers: [makeServer("s1")], channels: { s1: [makeChannel("c1", "s1")] } });
    useServerStore.getState().setActiveServer("s1");
    expect(useServerStore.getState().activeServerId).toBe("s1");
  });

  it("sets activeChannelId to first text channel of that server", () => {
    useServerStore.setState({
      servers: [makeServer("s1")],
      channels: { s1: [makeChannel("c1", "s1", "voice"), makeChannel("c2", "s1", "text")] },
    });
    useServerStore.getState().setActiveServer("s1");
    expect(useServerStore.getState().activeChannelId).toBe("c2");
  });

  it("sets activeChannelId to null when server has no channels", () => {
    useServerStore.setState({ servers: [makeServer("s1")], channels: {} });
    useServerStore.getState().setActiveServer("s1");
    expect(useServerStore.getState().activeChannelId).toBeNull();
  });

  it("accepts null to deselect server", () => {
    useServerStore.setState({ activeServerId: "s1" });
    useServerStore.getState().setActiveServer(null);
    expect(useServerStore.getState().activeServerId).toBeNull();
  });
});

// ── setActiveChannel ──────────────────────────────────────────────────────────

describe("setActiveChannel", () => {
  it("sets the active channel and clears its unread count", () => {
    useServerStore.setState({ unreadCounts: { c1: 5 } });
    useServerStore.getState().setActiveChannel("c1");
    expect(useServerStore.getState().activeChannelId).toBe("c1");
    expect(useServerStore.getState().unreadCounts["c1"]).toBe(0);
  });

  it("accepts null", () => {
    useServerStore.setState({ activeChannelId: "c1" });
    useServerStore.getState().setActiveChannel(null);
    expect(useServerStore.getState().activeChannelId).toBeNull();
  });
});

// ── removeServer ──────────────────────────────────────────────────────────────

describe("removeServer", () => {
  it("removes server from the list", () => {
    useServerStore.setState({ servers: [makeServer("s1"), makeServer("s2")], openTabs: ["s1", "s2"] });
    useServerStore.getState().removeServer("s1");
    expect(useServerStore.getState().servers.map((s) => s.id)).toEqual(["s2"]);
  });

  it("removes server from openTabs", () => {
    useServerStore.setState({ servers: [makeServer("s1")], openTabs: ["s1"] });
    useServerStore.getState().removeServer("s1");
    expect(useServerStore.getState().openTabs).not.toContain("s1");
  });

  it("clears activeServerId when the active server is removed", () => {
    useServerStore.setState({ servers: [makeServer("s1")], openTabs: ["s1"], activeServerId: "s1" });
    useServerStore.getState().removeServer("s1");
    expect(useServerStore.getState().activeServerId).toBeNull();
  });

  it("does not affect activeServerId when a non-active server is removed", () => {
    useServerStore.setState({
      servers: [makeServer("s1"), makeServer("s2")],
      openTabs: ["s1", "s2"],
      activeServerId: "s2",
    });
    useServerStore.getState().removeServer("s1");
    expect(useServerStore.getState().activeServerId).toBe("s2");
  });
});

// ── setTyping ─────────────────────────────────────────────────────────────────

describe("setTyping", () => {
  it("adds a user to the typing list", () => {
    useServerStore.getState().setTyping("c1", "u1", true);
    expect(useServerStore.getState().typingUsers["c1"]).toContain("u1");
  });

  it("removes a user from the typing list", () => {
    useServerStore.setState({ typingUsers: { c1: ["u1", "u2"] } });
    useServerStore.getState().setTyping("c1", "u1", false);
    expect(useServerStore.getState().typingUsers["c1"]).not.toContain("u1");
    expect(useServerStore.getState().typingUsers["c1"]).toContain("u2");
  });

  it("does not duplicate users", () => {
    useServerStore.setState({ typingUsers: { c1: ["u1"] } });
    useServerStore.getState().setTyping("c1", "u1", true);
    const list = useServerStore.getState().typingUsers["c1"];
    expect(list.filter((id) => id === "u1")).toHaveLength(1);
  });
});

// ── openTab / closeTab ────────────────────────────────────────────────────────

describe("openTab", () => {
  it("adds a server id to openTabs", () => {
    useServerStore.getState().openTab("s1");
    expect(useServerStore.getState().openTabs).toContain("s1");
  });

  it("does not duplicate an already-open tab", () => {
    useServerStore.setState({ openTabs: ["s1"] });
    useServerStore.getState().openTab("s1");
    expect(useServerStore.getState().openTabs.filter((id) => id === "s1")).toHaveLength(1);
  });
});

describe("closeTab", () => {
  it("removes the tab from openTabs", () => {
    useServerStore.setState({ openTabs: ["s1", "s2"], activeServerId: "s2", channels: {} });
    useServerStore.getState().closeTab("s1");
    expect(useServerStore.getState().openTabs).not.toContain("s1");
  });

  it("switches activeServerId to the next tab when the active tab is closed", () => {
    useServerStore.setState({
      openTabs: ["s1", "s2"],
      activeServerId: "s1",
      channels: { s2: [makeChannel("c2", "s2")] },
    });
    useServerStore.getState().closeTab("s1");
    expect(useServerStore.getState().activeServerId).toBe("s2");
  });

  it("sets activeServerId to null when the last tab is closed", () => {
    useServerStore.setState({ openTabs: ["s1"], activeServerId: "s1", channels: {} });
    useServerStore.getState().closeTab("s1");
    expect(useServerStore.getState().activeServerId).toBeNull();
  });
});

// ── toggleMute / toggleDeafen ─────────────────────────────────────────────────

describe("toggleMute", () => {
  it("flips isMuted from false to true", () => {
    useServerStore.setState({ isMuted: false });
    useServerStore.getState().toggleMute();
    expect(useServerStore.getState().isMuted).toBe(true);
  });

  it("flips isMuted from true to false", () => {
    useServerStore.setState({ isMuted: true });
    useServerStore.getState().toggleMute();
    expect(useServerStore.getState().isMuted).toBe(false);
  });
});

describe("toggleDeafen", () => {
  it("flips isDeafened from false to true", () => {
    useServerStore.setState({ isDeafened: false });
    useServerStore.getState().toggleDeafen();
    expect(useServerStore.getState().isDeafened).toBe(true);
  });

  it("flips isDeafened from true to false", () => {
    useServerStore.setState({ isDeafened: true });
    useServerStore.getState().toggleDeafen();
    expect(useServerStore.getState().isDeafened).toBe(false);
  });
});

// ── patchUser ─────────────────────────────────────────────────────────────────

describe("patchUser (server-store)", () => {
  const user = { id: "u1", username: "alice", email: "a@a.com", displayName: "Alice", createdAt: "2024-01-01" };
  const updatedUser = { ...user, displayName: "Alicia" };

  it("patches author on messages", () => {
    useServerStore.setState({
      messages: { c1: [{ ...makeMessage("m1", "c1"), author: user }] },
    });
    useServerStore.getState().patchUser(updatedUser);
    expect(useServerStore.getState().messages["c1"][0].author?.displayName).toBe("Alicia");
  });

  it("patches user on members", () => {
    useServerStore.setState({
      members: { s1: [{ ...makeMember("u1", "s1"), user }] },
    });
    useServerStore.getState().patchUser(updatedUser);
    expect(useServerStore.getState().members["s1"][0].user?.displayName).toBe("Alicia");
  });

  it("patches user on voice participants", () => {
    useServerStore.setState({
      voiceParticipants: {
        vc1: [{ userId: "u1", channelId: "vc1", isMuted: false, isDeafened: false, isScreenSharing: false, isSpeaking: false, user }],
      },
    });
    useServerStore.getState().patchUser(updatedUser);
    expect(useServerStore.getState().voiceParticipants["vc1"][0].user?.displayName).toBe("Alicia");
  });

  it("does not patch entries with different user id", () => {
    const otherUser = { id: "u2", username: "bob", email: "b@b.com", displayName: "Bob", createdAt: "2024-01-01" };
    useServerStore.setState({
      members: { s1: [{ ...makeMember("u2", "s1"), user: otherUser }] },
    });
    useServerStore.getState().patchUser(updatedUser);
    expect(useServerStore.getState().members["s1"][0].user?.displayName).toBe("Bob");
  });
});
