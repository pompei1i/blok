import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";

export let voicePresenceCh: RealtimeChannel | null = null;
export const setVoicePresenceCh = (ch: RealtimeChannel | null) => { voicePresenceCh = ch; };

/** Rebuilds voiceParticipants from voice presence; installed by initData with the channel. */
export let syncVoicePresence: () => void = () => {};
export const setSyncVoicePresence = (fn: () => void) => { syncVoicePresence = fn; };

// Tracks all long-lived realtime channels opened by initData so they can be
// cleaned up before re-init or on logout. Without this, each re-init leaks
// channels that continue firing duplicate events.
let _dataChannels: RealtimeChannel[] = [];

export function trackDataChannel(ch: RealtimeChannel): void {
  _dataChannels.push(ch);
}

export async function clearDataChannels(): Promise<void> {
  const toRemove = _dataChannels;
  _dataChannels = [];
  await Promise.all(toRemove.map((ch) => supabase.removeChannel(ch).catch(() => {})));
}
