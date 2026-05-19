import type { RealtimeChannel } from "@supabase/supabase-js";

export let voicePresenceCh: RealtimeChannel | null = null;
export const setVoicePresenceCh = (ch: RealtimeChannel | null) => { voicePresenceCh = ch; };

export let _currentUserId: string | null = null;
export const setCurrentUserId = (id: string | null) => { _currentUserId = id; };
