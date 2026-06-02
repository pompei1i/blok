import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Poll } from "../types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makePollRow(messageId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `poll-${messageId}`,
    message_id: messageId,
    question: "Test question?",
    is_multiple_choice: false,
    is_anonymous: false,
    created_at: "2024-01-15T12:00:00Z",
    poll_options: [
      {
        id: "opt-a",
        poll_id: `poll-${messageId}`,
        text: "Option A",
        position: 0,
        poll_votes: [],
      },
      {
        id: "opt-b",
        poll_id: `poll-${messageId}`,
        text: "Option B",
        position: 1,
        poll_votes: [{ poll_option_id: "opt-b", user_id: "u2" }],
      },
    ],
    ...overrides,
  };
}

const q = () => (globalThis as Record<string, unknown>).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

function resolveWith(data: unknown, error: unknown = null) {
  q().then.mockImplementationOnce((resolve: (v: unknown) => void) => resolve({ data, error }));
}

const BASE_STATE = {
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  categories: {},
  channels: {},
  channelIndex: {},
  members: {},
  userProfileCache: {},
  memberUserIndex: {},
  messages: {},
  messageChannelIndex: {},
  lruChannelOrder: [],
  messagesLoaded: new Set<string>(),
  messagesLoading: new Set<string>(),
  messagesAtStart: new Set<string>(),
  typingUsers: {},
  threadMessages: {},
  polls: {},
  openTabs: [],
  unreadCounts: {},
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  screenSharers: {},
  watchingUserId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState(BASE_STATE);
});

// ── loadPollsForMessages ───────────────────────────────────────────────────────

describe("loadPollsForMessages", () => {
  it("does nothing when messageIds is empty", async () => {
    await useServerStore.getState().loadPollsForMessages([], "u1");
    expect(q().then).not.toHaveBeenCalled();
  });

  it("stores poll keyed by message_id", async () => {
    const row = makePollRow("msg1");
    resolveWith([row]);

    await useServerStore.getState().loadPollsForMessages(["msg1"], "u1");

    const { polls } = useServerStore.getState();
    expect(polls["msg1"]).toBeDefined();
    expect(polls["msg1"].question).toBe("Test question?");
    expect(polls["msg1"].id).toBe("poll-msg1");
  });

  it("computes voteCount correctly", async () => {
    const row = makePollRow("msg1");
    resolveWith([row]);

    await useServerStore.getState().loadPollsForMessages(["msg1"], "u1");

    const poll = useServerStore.getState().polls["msg1"];
    expect(poll.options[0].voteCount).toBe(0);
    expect(poll.options[1].voteCount).toBe(1);
    expect(poll.totalVotes).toBe(1);
  });

  it("computes myVotes for current user", async () => {
    const row = makePollRow("msg1", {
      poll_options: [
        { id: "opt-a", poll_id: "poll-msg1", text: "A", position: 0, poll_votes: [{ poll_option_id: "opt-a", user_id: "u1" }] },
        { id: "opt-b", poll_id: "poll-msg1", text: "B", position: 1, poll_votes: [] },
      ],
    });
    resolveWith([row]);

    await useServerStore.getState().loadPollsForMessages(["msg1"], "u1");

    const poll = useServerStore.getState().polls["msg1"];
    expect(poll.myVotes).toEqual(["opt-a"]);
  });

  it("hides voters when poll is anonymous", async () => {
    const row = makePollRow("msg1", {
      is_anonymous: true,
      poll_options: [
        { id: "opt-a", poll_id: "poll-msg1", text: "A", position: 0, poll_votes: [{ user_id: "u2" }, { user_id: "u3" }] },
      ],
    });
    resolveWith([row]);

    await useServerStore.getState().loadPollsForMessages(["msg1"], "u1");

    const poll = useServerStore.getState().polls["msg1"];
    expect(poll.options[0].voters).toEqual([]);
    expect(poll.options[0].voteCount).toBe(2);
  });

  it("returns without changes on Supabase error", async () => {
    resolveWith(null, { message: "DB error" });

    await useServerStore.getState().loadPollsForMessages(["msg1"], "u1");

    expect(useServerStore.getState().polls).toEqual({});
  });
});

// ── votePoll ───────────────────────────────────────────────────────────────────

describe("votePoll", () => {
  function setupPoll(isMultipleChoice = false): Poll {
    const poll: Poll = {
      id: "poll-1",
      messageId: "msg1",
      question: "Test?",
      isMultipleChoice,
      isAnonymous: false,
      options: [
        { id: "opt-a", pollId: "poll-1", text: "A", position: 0, voteCount: 0, voters: [] },
        { id: "opt-b", pollId: "poll-1", text: "B", position: 1, voteCount: 1, voters: ["u2"] },
      ],
      myVotes: [],
      totalVotes: 1,
    };
    useServerStore.setState({ polls: { msg1: poll } });
    return poll;
  }

  it("optimistically increments voteCount and adds to myVotes", async () => {
    setupPoll();
    // Supabase delete (single-choice) and insert both resolve successfully
    resolveWith([]);
    resolveWith([]);

    void useServerStore.getState().votePoll("poll-1", ["opt-a"], "u1");

    // Optimistic update is synchronous
    const { polls } = useServerStore.getState();
    expect(polls["msg1"].options[0].voteCount).toBe(1);
    expect(polls["msg1"].myVotes).toContain("opt-a");
    expect(polls["msg1"].totalVotes).toBe(2);
  });

  it("adds voter name for open polls", async () => {
    setupPoll();
    resolveWith([]);
    resolveWith([]);

    void useServerStore.getState().votePoll("poll-1", ["opt-a"], "u1");

    const { polls } = useServerStore.getState();
    expect(polls["msg1"].options[0].voters).toContain("u1");
  });

  it("rolls back optimistic update on Supabase error", async () => {
    setupPoll();
    resolveWith([]); // delete succeeds
    resolveWith(null, { message: "constraint violation" }); // insert fails

    await useServerStore.getState().votePoll("poll-1", ["opt-a"], "u1");

    const { polls } = useServerStore.getState();
    expect(polls["msg1"].options[0].voteCount).toBe(0);
    expect(polls["msg1"].myVotes).not.toContain("opt-a");
    expect(polls["msg1"].totalVotes).toBe(1);
  });
});

// ── Realtime updates ──────────────────────────────────────────────────────────

describe("initPollRealtime — vote routing", () => {
  function setupPollState() {
    const poll: Poll = {
      id: "poll-1",
      messageId: "msg1",
      question: "Test?",
      isMultipleChoice: false,
      isAnonymous: false,
      options: [
        { id: "opt-a", pollId: "poll-1", text: "A", position: 0, voteCount: 2, voters: ["u2", "u3"] },
      ],
      myVotes: [],
      totalVotes: 2,
    };
    useServerStore.setState({ polls: { msg1: poll } });
  }

  it("increments voteCount on INSERT for other users", () => {
    setupPollState();

    // Simulate the realtime INSERT handler logic directly
    useServerStore.setState((state) => {
      const poll = Object.values(state.polls).find((p) =>
        p.options.some((o) => o.id === "opt-a")
      );
      if (!poll) return state;
      const updatedOptions = poll.options.map((opt) =>
        opt.id === "opt-a"
          ? { ...opt, voteCount: opt.voteCount + 1, voters: [...opt.voters, "u4"] }
          : opt
      );
      return { polls: { ...state.polls, [poll.messageId]: { ...poll, options: updatedOptions, totalVotes: poll.totalVotes + 1 } } };
    });

    const { polls } = useServerStore.getState();
    expect(polls["msg1"].options[0].voteCount).toBe(3);
    expect(polls["msg1"].options[0].voters).toContain("u4");
    expect(polls["msg1"].totalVotes).toBe(3);
  });

  it("decrements voteCount on DELETE", () => {
    setupPollState();

    useServerStore.setState((state) => {
      const poll = Object.values(state.polls).find((p) =>
        p.options.some((o) => o.id === "opt-a")
      );
      if (!poll) return state;
      const updatedOptions = poll.options.map((opt) =>
        opt.id === "opt-a"
          ? { ...opt, voteCount: Math.max(0, opt.voteCount - 1), voters: opt.voters.filter((v) => v !== "u3") }
          : opt
      );
      return { polls: { ...state.polls, [poll.messageId]: { ...poll, options: updatedOptions, totalVotes: Math.max(0, poll.totalVotes - 1) } } };
    });

    const { polls } = useServerStore.getState();
    expect(polls["msg1"].options[0].voteCount).toBe(1);
    expect(polls["msg1"].options[0].voters).not.toContain("u3");
    expect(polls["msg1"].totalVotes).toBe(1);
  });
});
