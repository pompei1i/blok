import type { ServerSlice } from "./slices/server-slice";
import type { MessageSlice } from "./slices/message-slice";
import type { VoiceSlice } from "./slices/voice-slice";

export type ServerStore = ServerSlice & MessageSlice & VoiceSlice;
