import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { supabase } from "./supabaseClient";
import type { VoiceCallbacks } from "./voice-engine";

type NativeSignalMsg =
  | { type: "join"; from: string }
  | { type: "hello"; from: string }
  | { type: "leave"; from: string }
  | { type: "audio"; from: string; data: string; rate?: number }
  | { type: "screenshare_start"; from: string }
  | { type: "screenshare_stop"; from: string };

const SPEAKING_TIMEOUT_MS = 400;

function int16ToBase64(samples: number[]): string {
  const bytes = new Uint8Array(new Int16Array(samples).buffer);
  // Chunk the spread to stay safely under V8's argument limit (65535).
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToInt16Array(b64: string): number[] {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(new Int16Array(bytes.buffer));
}

export class NativeVoiceEngine {
  private channelId: string;
  private userId: string;
  private cb: VoiceCallbacks;

  private realtimeCh: ReturnType<typeof supabase.channel> | null = null;
  private unlistenChunk: UnlistenFn | null = null;
  private unlistenSpeaking: UnlistenFn | null = null;

  private speakingState = new Map<string, boolean>();
  private speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private screenStream: MediaStream | null = null;
  private localRate = 48000;
  private _subscribed = false;
  private _subscribeResolve: (() => void) | null = null;
  private _subscribeReject: ((err: Error) => void) | null = null;
  private subscribePromise: Promise<void>;

  constructor(channelId: string, userId: string, cb: VoiceCallbacks) {
    this.channelId = channelId;
    this.userId = userId;
    this.cb = cb;
    this.subscribePromise = new Promise((res, rej) => {
      this._subscribeResolve = res;
      this._subscribeReject = rej;
    });
  }

  async join(): Promise<void> {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Native voice requires the desktop app");
    }
    // audio_start returns the actual input sample rate so we can tag every
    // outgoing packet; remote peers resample if their device differs.
    this.localRate = await invoke<number>("audio_start");
    invoke("disable_audio_ducking").catch(() => {});

    this.unlistenChunk = await listen<number[]>("audio-chunk", (event) => {
      if (!this.realtimeCh) return;
      const base64 = int16ToBase64(event.payload);
      this.realtimeCh
        .send({ type: "broadcast", event: "signal", payload: { type: "audio", from: this.userId, data: base64, rate: this.localRate } })
        .catch(() => {});
    });

    this.unlistenSpeaking = await listen<boolean>("audio-speaking", (event) => {
      this.updateSpeaking(this.userId, event.payload);
    });

    this.realtimeCh = supabase
      .channel(`voice:${this.channelId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        void this.handleSignal(payload as NativeSignalMsg);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !this._subscribed) {
          this._subscribed = true;
          this._subscribeResolve?.();
          this.broadcast({ type: "join", from: this.userId });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this._subscribeReject?.(new Error(`Voice channel subscription failed: ${status}`));
        }
      });

    await this.subscribePromise;
  }

  async leave(): Promise<void> {
    await this.broadcast({ type: "leave", from: this.userId });

    this.unlistenChunk?.();
    this.unlistenChunk = null;
    this.unlistenSpeaking?.();
    this.unlistenSpeaking = null;

    for (const t of this.speakingTimers.values()) clearTimeout(t);
    this.speakingTimers.clear();
    this.speakingState.clear();

    if (this.realtimeCh) {
      await supabase.removeChannel(this.realtimeCh);
      this.realtimeCh = null;
    }

    await invoke("audio_stop");
  }

  setMuted(muted: boolean): void {
    invoke("audio_set_muted", { muted }).catch(() => {});
  }

  setDeafened(deafened: boolean): void {
    invoke("audio_set_deafened", { deafened }).catch(() => {});
  }

  setInputVolume(_volume: number): void {}

  setNoiseGateThreshold(_value: number): void {}

  isScreenSharing(): boolean {
    return false;
  }

  async startScreenShare(_sourceId?: string): Promise<void> {
    // Sources are enumerated natively (get_screen_sources / get_window_sources).
    // getDisplayMedia is never called — it always triggers the system dialog
    // which we've replaced with our own picker. Video isn't transmitted to
    // remote peers yet, so a dummy stream is sufficient.
    this.screenStream = new MediaStream();
    await this.broadcast({ type: "screenshare_start", from: this.userId });
    this.cb.onScreenShareStart?.(this.userId, this.screenStream);
  }

  async stopScreenShare(): Promise<void> {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    await this.broadcast({ type: "screenshare_stop", from: this.userId });
    this.cb.onScreenShareStop?.(this.userId);
  }

  private async handleSignal(msg: NativeSignalMsg): Promise<void> {
    if (!msg || !msg.from) return;
    if (msg.from === this.userId) return;

    switch (msg.type) {
      case "join":
        this.cb.onParticipantJoin(msg.from);
        // Reply so the newcomer discovers existing participants
        await this.broadcast({ type: "hello", from: this.userId });
        break;
      case "hello":
        this.cb.onParticipantJoin(msg.from);
        break;
      case "leave":
        this.cb.onParticipantLeave(msg.from);
        this.clearPeerSpeaking(msg.from);
        invoke("audio_remove_peer", { peerId: msg.from }).catch(() => {});
        break;
      case "audio": {
        const samples = base64ToInt16Array(msg.data);
        const speaking = await invoke<boolean>("audio_receive", { from: msg.from, samples, rate: msg.rate ?? 48000 });
        this.updateSpeaking(msg.from, speaking);
        break;
      }
      case "screenshare_start":
        this.cb.onScreenShareStart?.(msg.from, new MediaStream());
        break;
      case "screenshare_stop":
        this.cb.onScreenShareStop?.(msg.from);
        break;
    }
  }

  private updateSpeaking(peerId: string, speaking: boolean): void {
    if (speaking) {
      if (!(this.speakingState.get(peerId) ?? false)) {
        this.speakingState.set(peerId, true);
        this.cb.onSpeakingChange(peerId, true);
      }
      const old = this.speakingTimers.get(peerId);
      if (old) clearTimeout(old);
      const t = setTimeout(() => {
        this.speakingState.set(peerId, false);
        this.cb.onSpeakingChange(peerId, false);
        this.speakingTimers.delete(peerId);
      }, SPEAKING_TIMEOUT_MS);
      this.speakingTimers.set(peerId, t);
    }
  }

  private clearPeerSpeaking(peerId: string): void {
    const t = this.speakingTimers.get(peerId);
    if (t) {
      clearTimeout(t);
      this.speakingTimers.delete(peerId);
    }
    if (this.speakingState.get(peerId)) {
      this.speakingState.set(peerId, false);
      this.cb.onSpeakingChange(peerId, false);
    }
    this.speakingState.delete(peerId);
  }

  private async broadcast(msg: NativeSignalMsg): Promise<void> {
    if (!this.realtimeCh) return;
    await this.realtimeCh.send({ type: "broadcast", event: "signal", payload: msg });
  }
}

let _activeEngine: NativeVoiceEngine | null = null;

export function getActiveNativeVoiceEngine(): NativeVoiceEngine | null {
  return _activeEngine;
}

export function setActiveNativeVoiceEngine(engine: NativeVoiceEngine | null): void {
  _activeEngine = engine;
}
