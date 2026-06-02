import type { ServerSlice } from "./slices/server-slice";
import type { MessageSlice } from "./slices/message-slice";
import type { VoiceSlice } from "./slices/voice-slice";
import type { PollSlice } from "./slices/poll-slice";

export type ServerStore = ServerSlice & MessageSlice & VoiceSlice & PollSlice;
