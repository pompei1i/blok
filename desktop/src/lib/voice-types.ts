// Shared voice engine types. The concrete transport lives in
// native-voice-engine.ts (Tauri + Supabase Realtime); this file holds only the
// callback contract that the store, dm-store, and tests depend on.

export interface VoiceCallbacks {
  // isFreshJoin = true only when the peer just arrived (a "join" broadcast), so
  // the UI can play a join chime. The handshake "hello" replies that the newcomer
  // receives from everyone already in the channel pass false (no chime storm).
  onParticipantJoin: (userId: string, isFreshJoin?: boolean) => void;
  onParticipantLeave: (userId: string) => void;
  /**
   * The transport to a peer failed or closed without a "leave" (crash, network
   * loss). The peer may still be in the channel and reconnecting, so this is a
   * cue to re-check presence, not a leave.
   */
  onPeerConnectionLost?: (userId: string) => void;
  onSpeakingChange: (userId: string, speaking: boolean) => void;
  onScreenShareStart?: (userId: string, stream: MediaStream) => void;
  onScreenShareStop?: (userId: string) => void;
  /** Fired on the sharer's side when a viewer connects to watch their screen. */
  onScreenWatched?: (viewerId: string) => void;
  onVideoStart?: (userId: string, stream: MediaStream) => void;
  onVideoStop?: (userId: string) => void;
}
