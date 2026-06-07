import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import type { Poll, PollOption } from "../types";
import type { ServerStore } from "../server-store.shape";

export interface PollSlice {
  polls: Record<string, Poll>;

  loadPollsForMessages: (messageIds: string[], currentUserId: string) => Promise<void>;
  createPoll: (params: {
    channelId: string;
    question: string;
    options: string[];
    isMultipleChoice: boolean;
    isAnonymous: boolean;
    authorId: string;
  }) => Promise<void>;
  votePoll: (pollId: string, optionIds: string[], userId: string) => Promise<void>;
  initPollRealtime: (userId: string) => void;
}

function buildPoll(row: any, currentUserId: string): Poll {
  const options: PollOption[] = (row.poll_options ?? [])
    .sort((a: any, b: any) => a.position - b.position)
    .map((opt: any) => {
      const votes: Array<{ user_id: string }> = opt.poll_votes ?? [];
      return {
        id: opt.id,
        pollId: opt.poll_id,
        text: opt.text,
        position: opt.position,
        voteCount: votes.length,
        voters: row.is_anonymous ? [] : votes.map((v) => v.user_id),
      };
    });

  const myVotes = options
    .filter((opt) =>
      (row.poll_options ?? [])
        .find((o: any) => o.id === opt.id)
        ?.poll_votes?.some((v: any) => v.user_id === currentUserId)
    )
    .map((opt) => opt.id);

  const totalVotes = options.reduce((sum, opt) => sum + opt.voteCount, 0);

  return {
    id: row.id,
    messageId: row.message_id,
    question: row.question,
    isMultipleChoice: row.is_multiple_choice,
    isAnonymous: row.is_anonymous,
    options,
    myVotes,
    totalVotes,
  };
}

export const createPollSlice: StateCreator<ServerStore, [], [], PollSlice> = (set, get) => ({
  polls: {},

  loadPollsForMessages: async (messageIds, currentUserId) => {
    if (messageIds.length === 0) return;
    const { data, error } = await supabase
      .from("polls")
      .select(`
        id, message_id, question, is_multiple_choice, is_anonymous, created_at,
        poll_options(id, poll_id, text, position, poll_votes(poll_option_id, user_id))
      `)
      .in("message_id", messageIds);
    if (error || !data || data.length === 0) return;

    const newPolls: Record<string, Poll> = {};
    for (const row of data) {
      const poll = buildPoll(row, currentUserId);
      newPolls[row.message_id] = poll;
    }
    set((state) => ({ polls: { ...state.polls, ...newPolls } }));
  },

  createPoll: async ({ channelId, question, options, isMultipleChoice, isAnonymous, authorId }) => {
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: authorId, content: "" })
      .select("id")
      .single();
    if (msgErr || !msg) { console.error("createPoll: message insert failed", msgErr); return; }

    const { data: poll, error: pollErr } = await supabase
      .from("polls")
      .insert({ message_id: msg.id, question, is_multiple_choice: isMultipleChoice, is_anonymous: isAnonymous })
      .select("id")
      .single();
    if (pollErr || !poll) { console.error("createPoll: poll insert failed", pollErr); return; }

    const { error: optErr } = await supabase.from("poll_options").insert(
      options.map((text, i) => ({ poll_id: poll.id, text, position: i }))
    );
    if (optErr) console.error("createPoll: options insert failed", optErr);
  },

  votePoll: async (pollId, optionIds, userId) => {
    const poll = Object.values(get().polls).find((p) => p.id === pollId);
    if (!poll) return;

    // Optimistic update
    set((state) => {
      const existing = state.polls[poll.messageId];
      if (!existing) return state;
      const updatedOptions = existing.options.map((opt) => {
        const isVoted = optionIds.includes(opt.id);
        if (!isVoted) return opt;
        return {
          ...opt,
          voteCount: opt.voteCount + 1,
          voters: existing.isAnonymous ? opt.voters : [...opt.voters, userId],
        };
      });
      return {
        polls: {
          ...state.polls,
          [poll.messageId]: {
            ...existing,
            options: updatedOptions,
            myVotes: [...existing.myVotes, ...optionIds],
            totalVotes: existing.totalVotes + optionIds.length,
          },
        },
      };
    });

    // For single-choice, delete any existing vote first
    if (!poll.isMultipleChoice) {
      await supabase.from("poll_votes")
        .delete()
        .eq("poll_id", pollId)
        .eq("user_id", userId);
    }

    const { error } = await supabase.from("poll_votes").insert(
      optionIds.map((optionId) => ({ poll_option_id: optionId, poll_id: pollId, user_id: userId }))
    );

    if (error) {
      console.error("votePoll failed", error);
      // Rollback optimistic update
      set((state) => {
        const existing = state.polls[poll.messageId];
        if (!existing) return state;
        const rolledBack = existing.options.map((opt) => {
          const wasVoted = optionIds.includes(opt.id);
          if (!wasVoted) return opt;
          return {
            ...opt,
            voteCount: Math.max(0, opt.voteCount - 1),
            voters: existing.isAnonymous ? opt.voters : opt.voters.filter((v) => v !== userId),
          };
        });
        return {
          polls: {
            ...state.polls,
            [poll.messageId]: {
              ...existing,
              options: rolledBack,
              myVotes: existing.myVotes.filter((id) => !optionIds.includes(id)),
              totalVotes: Math.max(0, existing.totalVotes - optionIds.length),
            },
          },
        };
      });
    }
  },

  initPollRealtime: (_userId) => {
    supabase.channel("public:poll_votes").on(
      "postgres_changes",
      { event: "*", schema: "public", table: "poll_votes" },
      (payload) => {
        if (payload.eventType === "INSERT") {
          const v = payload.new;
          set((state) => {
            const poll = Object.values(state.polls).find((p) =>
              p.options.some((o) => o.id === v.poll_option_id)
            );
            if (!poll) return state;
            // Skip if it's the current user's own vote (already applied optimistically)
            if (v.user_id === get()._currentUserId) return state;
            const updatedOptions = poll.options.map((opt) =>
              opt.id === v.poll_option_id
                ? {
                    ...opt,
                    voteCount: opt.voteCount + 1,
                    voters: poll.isAnonymous ? opt.voters : [...opt.voters, v.user_id],
                  }
                : opt
            );
            return {
              polls: {
                ...state.polls,
                [poll.messageId]: {
                  ...poll,
                  options: updatedOptions,
                  totalVotes: poll.totalVotes + 1,
                },
              },
            };
          });
        } else if (payload.eventType === "DELETE") {
          const v = payload.old;
          set((state) => {
            const poll = Object.values(state.polls).find((p) =>
              p.options.some((o) => o.id === v.poll_option_id)
            );
            if (!poll) return state;
            const updatedOptions = poll.options.map((opt) =>
              opt.id === v.poll_option_id
                ? {
                    ...opt,
                    voteCount: Math.max(0, opt.voteCount - 1),
                    voters: opt.voters.filter((uid) => uid !== v.user_id),
                  }
                : opt
            );
            return {
              polls: {
                ...state.polls,
                [poll.messageId]: {
                  ...poll,
                  options: updatedOptions,
                  totalVotes: Math.max(0, poll.totalVotes - 1),
                },
              },
            };
          });
        }
      }
    ).subscribe();
  },
});
