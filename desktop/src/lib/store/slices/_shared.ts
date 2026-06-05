import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";

export let voicePresenceCh: RealtimeChannel | null = null;
export const setVoicePresenceCh = (ch: RealtimeChannel | null) => { voicePresenceCh = ch; };

export let _currentUserId: string | null = null;
export const setCurrentUserId = (id: string | null) => { _currentUserId = id; };

// Tracks all long-lived realtime channels opened by initData so they can be
// cleaned up before re-init (joinByInviteCode) or on logout. Without this,
// each re-init leaks 4 channels that continue firing duplicate events.
let _dataChannels: RealtimeChannel[] = [];

export function trackDataChannel(ch: RealtimeChannel): void {
  _dataChannels.push(ch);
}

export async function clearDataChannels(): Promise<void> {
  const toRemove = _dataChannels;
  _dataChannels = [];
  await Promise.all(toRemove.map((ch) => supabase.removeChannel(ch).catch(() => {})));
}
