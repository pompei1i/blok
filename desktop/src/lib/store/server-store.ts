import { create } from "zustand";
import { createServerSlice } from "./slices/server-slice";
import { createMessageSlice } from "./slices/message-slice";
import { createVoiceSlice } from "./slices/voice-slice";
import { createPollSlice } from "./slices/poll-slice";
import type { ServerStore } from "./server-store.shape";

export const useServerStore = create<ServerStore>()((...a) => ({
  ...createServerSlice(...a),
  ...createMessageSlice(...a),
  ...createVoiceSlice(...a),
  ...createPollSlice(...a),
}));
