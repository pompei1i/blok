import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createServerSlice } from "./slices/server-slice";
import { createMessageSlice } from "./slices/message-slice";
import { createVoiceSlice } from "./slices/voice-slice";
import { createPollSlice } from "./slices/poll-slice";
import type { ServerStore } from "./server-store.shape";

export const useServerStore = create<ServerStore>()(
  persist(
    (...a) => ({
      ...createServerSlice(...a),
      ...createMessageSlice(...a),
      ...createVoiceSlice(...a),
      ...createPollSlice(...a),
    }),
    {
      name: "blok-server-tabs",
      partialize: (s) => ({
        openTabs: s.openTabs,
        activeServerId: s.activeServerId,
        lastChannelPerServer: s.lastChannelPerServer,
        serverAccessOrder: s.serverAccessOrder,
      }),
    },
  ),
);
