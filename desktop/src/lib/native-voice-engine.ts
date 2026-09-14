import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { supabase } from "./supabaseClient";
import type { VoiceCallbacks } from "./voice-types";
import { WifiOff } from "lucide-react";
import { useUiSettingsStore } from "./store/ui-settings-store";
import { useToastStore } from "./store/toast-store";
import { useScreenPickerStore, type CaptureSource, type PickResult } from "./store/screen-picker-store";
import { SCREEN_RES_TO_MAX_WIDTH, SCREEN_QUALITY_TO_JPEG } from "@/lib/constants";
import { translate } from "./i18n";

type NativeSignalMsg =
  | { type: "join"; from: string }
  | { type: "hello"; from: string }
  | { type: "leave"; from: string }
  // Native (Rust) transport signaling: one peer connection per pair carries
  // voice + screen + camera as data channels; payload is SDP or ICE JSON.
  | { type: "rtc_offer"; from: string; to: string; payload: string }
  | { type: "rtc_answer"; from: string; to: string; payload: string }
  | { type: "rtc_ice"; from: string; to: string; payload: string }
  | { type: "screenshare_start"; from: string }
  | { type: "screenshare_stop"; from: string }
  | { type: "screenshare_offer"; from: string; to: string; sdp: string }
  | { type: "screenshare_answer"; from: string; to: string; sdp: string }
  | { type: "screenshare_ice"; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "video_start"; from: string }
  | { type: "video_stop"; from: string }
  | { type: "video_offer"; from: string; to: string; sdp: string }
  | { type: "video_answer"; from: string; to: string; sdp: string }
  | { type: "video_ice"; from: string; to: string; candidate: RTCIceCandidateInit };

const SPEAKING_TIMEOUT_MS = 400;

// ICE servers. TURN is required when both peers are behind NAT (typical home
// networks) — without a working relay the peer connection never establishes, so
// nothing comes through: no voice, and a black screen for share/camera. (Audio
// used to survive a dead relay because it went over the Supabase realtime
// broadcast; since the native webrtc-rs transport, PCM rides the same peer
// connection as video.) Provide a real TURN via env:
//   VITE_TURN_URLS=turn:host:3478,turns:host:5349?transport=tcp
//   VITE_TURN_USERNAME=...   VITE_TURN_CREDENTIAL=...
// Falls back to the free Open Relay demo, which is unreliable / often down.
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const urls = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(",").map((u) => u.trim()).filter(Boolean);
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (urls && urls.length > 0 && username && credential) {
    servers.push({ urls, username, credential });
  } else {
    servers.push({
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    });
  }
  return servers;
}

// Cloudflare TURN: the client fetches short-lived ICE credentials from our Supabase
// Edge Function (`turn`) so the Cloudflare API token never ships in the binary.
// Cached until the creds near expiry; falls back to env TURN / STUN (buildIceServers)
// if the fetch fails (e.g. function not deployed, offline).
let _iceCache: { config: RTCConfiguration; expiresAt: number } | null = null;

async function getIceConfig(): Promise<RTCConfiguration> {
  if (_iceCache && Date.now() < _iceCache.expiresAt) return _iceCache.config;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("no session");
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/turn`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`turn ${res.status}`);
    const data = (await res.json()) as { iceServers: RTCIceServer | RTCIceServer[]; ttl?: number };
    const cf = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    const config: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }, ...cf],
    };
    const ttlMs = (data.ttl ?? 3600) * 1000;
    _iceCache = { config, expiresAt: Date.now() + Math.max(60_000, ttlMs - 60_000) };
    return config;
  } catch (e) {
    console.warn("[voice] TURN creds fetch failed; using STUN/env fallback:", e);
    return { iceServers: buildIceServers() };
  }
}

export interface TurnTestResult {
  ok: boolean;
  /** Short human-readable status for the UI. */
  detail: string;
  /** True if a TURN url was present in the fetched config. */
  hasTurn: boolean;
  /** True if ICE gathered a `relay` candidate (proves the TURN server is reachable). */
  relayReachable: boolean;
  /** True when we fell back to the dead public openrelay (i.e. the Cloudflare fetch failed). */
  usingFallback: boolean;
  /** Host of the first TURN server actually used (cloudflare vs openrelay). */
  turnHost?: string;
  /** ICE candidate types observed: host / srflx (STUN) / relay (TURN). */
  candidateTypes: string[];
}

/**
 * End-to-end TURN check usable in the production build (no DevTools needed):
 * fetch ICE config, then gather ICE candidates and look for a `relay` candidate.
 * A relay candidate proves the TURN server actually minted creds AND is reachable —
 * the exact thing screen share / camera / voice rely on cross-NAT.
 *
 * It also disambiguates the two failure modes that look identical otherwise:
 * Cloudflare TURN reachable vs. silently falling back to the dead public relay
 * (getIceConfig() swallows a failed fetch and returns the openrelay fallback).
 */
export async function testTurnConnectivity(timeoutMs = 10000): Promise<TurnTestResult> {
  let config: RTCConfiguration;
  try {
    config = await getIceConfig();
  } catch {
    return { ok: false, detail: "Could not fetch ICE config", hasTurn: false, relayReachable: false, usingFallback: false, candidateTypes: [] };
  }

  const turnUrls: string[] = [];
  for (const s of config.iceServers ?? []) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const u of urls) {
      if (typeof u === "string" && (u.startsWith("turn:") || u.startsWith("turns:"))) turnUrls.push(u);
    }
  }
  const hasTurn = turnUrls.length > 0;
  const turnHost = turnUrls[0]?.replace(/^turns?:/, "").split(/[:?]/)[0];
  const usingFallback = turnUrls.some((u) => u.includes("openrelay.metered.ca"));
  if (!hasTurn) {
    return { ok: false, detail: "No TURN server in config (STUN only — cross-NAT will fail)", hasTurn: false, relayReachable: false, usingFallback: false, turnHost, candidateTypes: [] };
  }

  // Desktop app: probe natively via rtc.rs (WebKitGTK on Linux has no
  // RTCPeerConnection at all, and the native transport is what actually
  // carries calls now — so it's also the more honest thing to test).
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const probe = await invoke<{ relay_reachable: boolean; candidate_types: string[] }>(
        "rtc_test_turn",
        { iceServersJson: JSON.stringify(config.iceServers ?? []) },
      );
      const seen = probe.candidate_types.length ? `got ${probe.candidate_types.join("/")}` : "no candidates at all";
      if (probe.relay_reachable) {
        return {
          ok: true,
          detail: usingFallback ? "Relay OK (public fallback — set up Cloudflare)" : "TURN relay reachable — connections should work",
          hasTurn, relayReachable: true, usingFallback, turnHost,
          candidateTypes: probe.candidate_types,
        };
      }
      return {
        ok: false,
        detail: usingFallback
          ? `Cloudflare TURN unavailable — fell back to a dead public relay (${seen})`
          : `TURN unreachable — no relay candidate (${seen})`,
        hasTurn, relayReachable: false, usingFallback, turnHost,
        candidateTypes: probe.candidate_types,
      };
    } catch (e) {
      return { ok: false, detail: `Native probe failed: ${e instanceof Error ? e.message : e}`, hasTurn, relayReachable: false, usingFallback, turnHost, candidateTypes: [] };
    }
  }

  return await new Promise<TurnTestResult>((resolve) => {
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(config);
    } catch (e) {
      resolve({ ok: false, detail: `WebRTC unavailable: ${e instanceof Error ? e.message : e}`, hasTurn, relayReachable: false, usingFallback, turnHost, candidateTypes: [] });
      return;
    }
    const types = new Set<string>();
    let done = false;
    const failMsg = () => {
      const seen = types.size ? `got ${[...types].join("/")}` : "no candidates at all";
      return usingFallback
        ? `Cloudflare TURN unavailable — fell back to a dead public relay (${seen})`
        : `TURN unreachable — no relay candidate (${seen})`;
    };
    const finish = (relay: boolean, detail: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { pc.close(); } catch { /* already closed */ }
      resolve({ ok: relay, detail, hasTurn: true, relayReachable: relay, usingFallback, turnHost, candidateTypes: [...types] });
    };
    const timer = setTimeout(() => finish(false, failMsg()), timeoutMs);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) {
        // gathering complete — if no relay turned up by now it won't
        if (!types.has("relay")) finish(false, failMsg());
        return;
      }
      const m = candidate.candidate.match(/ typ (\w+)/);
      if (m) types.add(m[1]);
      if (candidate.candidate.includes(" typ relay")) {
        finish(true, usingFallback ? "Relay OK (public fallback — set up Cloudflare)" : "TURN relay reachable — connections should work");
      }
    };
    pc.createDataChannel("turn-probe");
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(() => finish(false, "ICE probe failed to start"));
  });
}


export class NativeVoiceEngine {
  private channelId: string;
  private userId: string;
  private cb: VoiceCallbacks;

  private realtimeCh: ReturnType<typeof supabase.channel> | null = null;
  private unlistenSpeaking: UnlistenFn | null = null;

  private speakingState = new Map<string, boolean>();
  private speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private screenStream: MediaStream | null = null;
  private _nativeCaptureCleanup: (() => void) | null = null;
  /** Active native (Linux) capture session — lets source/quality/fps change mid-share. */
  private _nativeCapture: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    sourceId: string;
    /**
     * Whether desktop audio is running for this share. Tracked here because it
     * cannot be read back from `screenStream`: desktop audio is captured in Rust
     * and fanned out over the native transport, so it never becomes a track on
     * the MediaStream. Inferring it from `getAudioTracks()` always answered
     * "no", which unticked the picker's audio box on every source switch and
     * made an unchanged audio choice look like a change.
     */
    withAudio: boolean;
  } | null = null;
  private _subscribed = false;
  private _subscribeResolve: (() => void) | null = null;
  private _subscribeReject: ((err: Error) => void) | null = null;
  private subscribePromise: Promise<void>;

  private _cameraStream: MediaStream | null = null;

  // ── Voice/media transport: native Rust webrtc (rtc.rs), NOT browser WebRTC ──
  // WebKitGTK on Linux ships without RTCPeerConnection entirely, so the peer
  // connections live in Rust (same path on Windows — universal). JS only relays
  // signaling strings and receives events over one binary channel. Voice, screen
  // and camera all ride one connection per peer as data channels.
  private _rtcPeers = new Set<string>();
  private _rtcStarted = false;

  // Per-user local controls (not synced to remote); effective volume (0 when
  // locally muted) is pushed down into the Rust mixer via rtc_set_user_volume.
  private _userVolumes = new Map<string, number>();
  private _localMuted = new Set<string>();

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
    if (this.realtimeCh) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Native voice requires the desktop app");
    }
    const { inputDevice, outputDevice, noiseSuppression, echoCancellation } = useUiSettingsStore.getState();

    // Captured PCM is fanned out to peers entirely inside Rust (audio.rs →
    // rtc.rs) — this channel is kept only because audio_start requires it; the
    // frames it carries are unused in JS now.
    const onChunk = new Channel<ArrayBuffer>();
    onChunk.onmessage = () => {};

    await invoke<number>("audio_start", {
      inputDevice: inputDevice || null,
      outputDevice: outputDevice || null,
      noiseSuppression,
      echoCancellation,
      onChunk,
    });
    invoke("disable_audio_ducking").catch(() => {});

    // Bring up the native P2P transport before announcing ourselves — peers
    // respond to our join immediately with signaling we must be able to accept.
    await this._startRtc();

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
        if (status === "SUBSCRIBED") {
          if (!this._subscribed) {
            this._subscribed = true;
            this._subscribeResolve?.();
            this.broadcast({ type: "join", from: this.userId });
          } else if (this.realtimeCh) {
            // Rejoined after a network drop (supabase-js auto-rejoins channels
            // once the socket reconnects). Re-announce so peers rebuild anything
            // that died during the outage: their join-handler sends hello back
            // (→ _ensureAudioPc rebuilds dead audio PCs) and re-broadcasts their
            // screenshare/video. Healthy PCs ignore all of it.
            console.info("[voice] realtime channel rejoined — re-announcing");
            void this.broadcast({ type: "join", from: this.userId });
            if (this.isScreenSharing()) void this.broadcast({ type: "screenshare_start", from: this.userId });
            if (this._cameraStream) void this.broadcast({ type: "video_start", from: this.userId });
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (!this._subscribed) {
            this._subscribeReject?.(new Error(`Voice channel subscription failed: ${status}`));
          } else {
            // Transient outage after a successful join — the client retries the
            // rejoin with backoff; the SUBSCRIBED branch above handles recovery.
            console.warn(`[voice] realtime channel ${status} — waiting for auto-rejoin`);
          }
        }
      });

    try {
      await this.subscribePromise;
    } catch (err) {
      this.unlistenSpeaking?.(); this.unlistenSpeaking = null;
      if (this.realtimeCh) { await supabase.removeChannel(this.realtimeCh); this.realtimeCh = null; }
      await invoke("audio_stop");
      throw err;
    }
  }

  async leave(): Promise<void> {
    if (this.screenStream) {
      await this.stopScreenShare();
    }

    await this.broadcast({ type: "leave", from: this.userId });

    // audio_stop below tears down the Rust engine, which drops its end of the
    // binary chunk channel — no explicit unlisten needed for it.
    this.unlistenSpeaking?.();
    this.unlistenSpeaking = null;

    for (const t of this.speakingTimers.values()) clearTimeout(t);
    this.speakingTimers.clear();
    this.speakingState.clear();

    // Close all native P2P connections + local media.
    this._rtcPeers.clear();
    invoke("rtc_close_all").catch(() => {});
    for (const key of [...this._remoteVideo.keys()]) {
      const rv = this._remoteVideo.get(key);
      if (rv) { rv.canvas.width = 0; rv.canvas.height = 0; }
    }
    this._remoteVideo.clear();
    this._stopCameraEncode();
    if (this._cameraStream) { this._cameraStream.getTracks().forEach((t) => t.stop()); this._cameraStream = null; }
    if (this.screenStream) { this.screenStream.getTracks().forEach((t) => t.stop()); this.screenStream = null; }

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

  setUserVolume(userId: string, volume: number): void {
    this._userVolumes.set(userId, volume);
    this._pushUserVolume(userId);
  }

  setLocalMute(userId: string, muted: boolean): void {
    if (muted) this._localMuted.add(userId);
    else this._localMuted.delete(userId);
    this._pushUserVolume(userId);
  }

  /** Effective per-user volume (0 when locally muted) → Rust mixer. */
  private _pushUserVolume(userId: string): void {
    const vol = this._localMuted.has(userId) ? 0 : (this._userVolumes.get(userId) ?? 100) / 100;
    invoke("rtc_set_user_volume", { peerId: userId, volume: vol }).catch(() => {});
  }

  // ── Native transport (rtc.rs): peer lifecycle + event channel ───────────────

  /**
   * Start the Rust transport runtime and subscribe to its multiplexed event
   * channel. Framing (first byte = event type) mirrors rtc.rs:
   *   0x01 signal-out, 0x02 conn-state, 0x03 video frame, 0x04 speaking.
   */
  private async _startRtc(): Promise<void> {
    if (this._rtcStarted) return;
    this._rtcStarted = true;

    const onEvent = new Channel<ArrayBuffer>();
    onEvent.onmessage = (buf) => {
      const d = new Uint8Array(buf);
      if (d.length < 4) return;
      const kindByte = d[1];
      const idLen = d[2] | (d[3] << 8);
      if (d.length < 4 + idLen) return;
      const peerId = new TextDecoder().decode(d.subarray(4, 4 + idLen));
      switch (d[0]) {
        case 0x01: { // outbound signaling → Supabase
          const payload = new TextDecoder().decode(d.subarray(4 + idLen));
          const type = kindByte === 1 ? "rtc_offer" : kindByte === 2 ? "rtc_answer" : "rtc_ice";
          void this.broadcast({ type, from: this.userId, to: peerId, payload });
          break;
        }
        case 0x02: { // connection state
          // 3 = failed: rebuild via the same glare rule (Rust replaces the peer).
          if (kindByte === 3 && this._rtcPeers.has(peerId)) {
            console.warn(`[voice] rtc↔${peerId.slice(0, 8)} failed — rebuilding`);
            void invoke("rtc_create_peer", { peerId, initiator: this.userId < peerId }).catch(() => {});
          }
          break;
        }
        case 0x03: { // video frame (screen/camera) — wired up in later phases
          const body = d.subarray(4 + idLen);
          this._onRtcVideoFrame(peerId, kindByte, body);
          break;
        }
        case 0x04: // speaking indicator (Rust debounces transitions)
          this.updateSpeaking(peerId, kindByte === 1);
          break;
      }
    };

    await invoke("rtc_start", { onEvent });
    const config = await getIceConfig();
    await invoke("rtc_set_ice_servers", { json: JSON.stringify(config.iceServers ?? []) }).catch((e) =>
      console.warn("[voice] rtc_set_ice_servers failed:", e),
    );
  }

  // Per-remote-source incoming video: a hidden canvas fed by the transport's
  // JPEG frames, exposed to the UI as a MediaStream via captureStream(). Keyed
  // by `${peerId}:${tag}` (tag 1 = screen, 2 = camera).
  private _remoteVideo = new Map<
    string,
    { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; lastSeq: number; drawing: boolean; pending: Uint8Array | null }
  >();

  /**
   * Handle an inbound video frame from the native transport. Body layout:
   * [u32-LE seq][u32-LE w][u32-LE h][jpeg]. Decodes to a per-source canvas and,
   * on the first frame, hands a captureStream() MediaStream to the UI via the
   * same callbacks the old media-track path used.
   */
  private _onRtcVideoFrame(peerId: string, tag: number, body: Uint8Array): void {
    if (body.length <= 12) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const seq = dv.getUint32(0, true);
    const w = dv.getUint32(4, true);
    const h = dv.getUint32(8, true);
    const jpeg = body.subarray(12);
    const key = `${peerId}:${tag}`;

    let rv = this._remoteVideo.get(key);
    if (!rv) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      rv = { canvas, ctx, lastSeq: 0, drawing: false, pending: null };
      this._remoteVideo.set(key, rv);
      const stream = canvas.captureStream();
      if (tag === 1) this.cb.onScreenShareStart?.(peerId, stream);
      else this.cb.onVideoStart?.(peerId, stream);
    }

    // Drop out-of-order stragglers; coalesce backlog to the newest frame.
    if (seq < rv.lastSeq) return;
    rv.lastSeq = seq;
    if (rv.drawing) {
      rv.pending = jpeg.slice();
      return;
    }
    void this._drawRemote(rv, jpeg);
  }

  private async _drawRemote(
    rv: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; drawing: boolean; pending: Uint8Array | null },
    jpeg: Uint8Array,
  ): Promise<void> {
    rv.drawing = true;
    let next: Uint8Array | null = jpeg;
    while (next) {
      const cur: Uint8Array = next;
      next = null;
      try {
        const bitmap = await createImageBitmap(new Blob([cur], { type: "image/jpeg" }));
        if (rv.canvas.width !== bitmap.width) rv.canvas.width = bitmap.width;
        if (rv.canvas.height !== bitmap.height) rv.canvas.height = bitmap.height;
        rv.ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch {
        /* skip undecodable frame */
      }
      next = rv.pending;
      rv.pending = null;
    }
    rv.drawing = false;
  }

  private _teardownRemoteVideo(peerId: string, tag: number): void {
    const key = `${peerId}:${tag}`;
    const rv = this._remoteVideo.get(key);
    if (rv) {
      rv.canvas.width = 0;
      rv.canvas.height = 0;
      this._remoteVideo.delete(key);
    }
  }

  /** Ensure a native peer connection exists. Smaller userId offers (glare rule). */
  private _ensureRtcPeer(peerId: string): void {
    if (this._rtcPeers.has(peerId)) return;
    this._rtcPeers.add(peerId);
    void invoke("rtc_create_peer", { peerId, initiator: this.userId < peerId }).catch(() => {});
  }

  private _closeRtcPeer(peerId: string): void {
    this._rtcPeers.delete(peerId);
    invoke("rtc_close_peer", { peerId }).catch(() => {});
    this._teardownRemoteVideo(peerId, 1);
    this._teardownRemoteVideo(peerId, 2);
    this.clearPeerSpeaking(peerId);
  }

  isScreenSharing(): boolean {
    return this.screenStream !== null;
  }

  /** Our own outgoing screen-share stream, for the local self-preview tile. */
  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  /**
   * True while we're actively receiving this sharer's screen (a live decode
   * canvas exists). Used by presence reconciliation to tell a briefly-lagging
   * presence flag apart from a genuinely stale stream.
   */
  hasLiveViewerPc(sharerId: string): boolean {
    return this._remoteVideo.has(`${sharerId}:1`);
  }

  async startScreenShare(): Promise<void> {
    if (this.screenStream) return;

    // One universal path on both OSes: our own picker (list_capture_sources) +
    // native capture (X11 on Linux, GDI on Windows), fanned out to peers from
    // Rust. getDisplayMedia is retired — its OS picker differed per platform and
    // doesn't exist at all on Linux/WebKitGTK.
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error(translate("screenShare.requiresDesktop"));
    }
    const stream = await this._startNativeScreenCapture();
    this.screenStream = stream;

    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) videoTrack.contentHint = "detail";
    videoTrack?.addEventListener("ended", () => { void this.stopScreenShare(); }, { once: true });

    await this.broadcast({ type: "screenshare_start", from: this.userId });
  }

  /**
   * Native-capture fallback for platforms with no browser-level screen capture
   * (currently: Linux without a portal ScreenCast backend). Rust runs its own
   * capture loop (direct X11, no portal) and pushes raw JPEG frames over a
   * binary channel; each frame is drawn onto a hidden canvas whose
   * captureStream() output plugs into the exact same WebRTC/broadcast pipeline
   * as a getDisplayMedia() stream downstream.
   */
  /**
   * (Re)start the Rust push-capture loop for `sourceId` with the current user
   * settings, drawing into the given canvas. Each `screen_capture_start` bumps a
   * generation counter Rust-side, so any previous loop dies on its own — calling
   * this again IS the "change source / change quality / change fps" operation,
   * with no WebRTC renegotiation (the canvas track just keeps flowing).
   */
  private async _startNativePush(
    sourceId: string,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ): Promise<boolean> {
    const { screenShareFps, screenShareResolution, screenShareQuality } = useUiSettingsStore.getState();
    const maxWidth = SCREEN_RES_TO_MAX_WIDTH[screenShareResolution];
    const jpegQuality = Math.round(SCREEN_QUALITY_TO_JPEG[screenShareQuality] * 100);

    // Rust pushes frames as [u32-LE w][u32-LE h][JPEG bytes]. Decode with
    // createImageBitmap (off-main-thread in WebKit) and draw. If a frame arrives
    // while a decode is in flight, park it as `pending` and draw it right after —
    // dropping it outright (the previous behaviour) halved the effective fps as
    // soon as decode time approached the frame period.
    let drawing = false;
    let pending: ArrayBuffer | null = null;
    let firstFrame: ((ok: boolean) => void) | null = null;
    const drawFrame = async (buf: ArrayBuffer): Promise<void> => {
      drawing = true;
      let next: ArrayBuffer | null = buf;
      while (next) {
        const cur: ArrayBuffer = next;
        next = null;
        const dv = new DataView(cur);
        const w = dv.getUint32(0, true);
        const h = dv.getUint32(4, true);
        try {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(cur, 8)], { type: "image/jpeg" }));
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          ctx.drawImage(bitmap, 0, 0, w, h);
          bitmap.close();
          firstFrame?.(true);
          firstFrame = null;
        } catch {
          /* skip undecodable frame */
        }
        next = pending;
        pending = null;
      }
      drawing = false;
    };
    const onFrame = new Channel<ArrayBuffer>();
    onFrame.onmessage = (buf) => {
      if (buf.byteLength <= 8) return;
      if (drawing) {
        pending = buf; // keep only the newest backlog frame
        return;
      }
      void drawFrame(buf);
    };

    const firstFramePromise = new Promise<boolean>((resolve) => {
      firstFrame = resolve;
      setTimeout(() => { firstFrame = null; resolve(false); }, 3000);
    });

    await invoke("screen_capture_start", { sourceId, maxWidth, jpegQuality, fps: screenShareFps, onFrame });
    return await firstFramePromise;
  }

  /** True when the current share runs on the native (Linux) capture path. */
  isNativeScreenShare(): boolean {
    return this._nativeCapture !== null;
  }

  /**
   * Mid-share source switch: re-opens the picker (audio checkbox pre-seeded with
   * the current state) and repoints the capture. If only the source changed, the
   * Rust loop is repointed with zero interruption; if the audio choice changed,
   * the share is restarted internally (tracks can't be added/removed from a
   * negotiated PC without renegotiation) — viewers reconnect after a brief blip.
   * Native path only; on getDisplayMedia the OS picker owns source selection.
   */
  async changeScreenShareSource(): Promise<void> {
    const nc = this._nativeCapture;
    if (!nc) return;
    const hadAudio = nc.withAudio;
    const sources = await invoke<CaptureSource[]>("list_capture_sources").catch(() => []);
    const choice = await useScreenPickerStore.getState().requestPick(sources, { initialAudio: hadAudio });
    if (!choice) return; // cancelled — keep sharing the current source

    if (choice.withAudio === hadAudio) {
      const sourceChanged = nc.sourceId !== choice.sourceId;
      nc.sourceId = choice.sourceId;
      await this._startNativePush(choice.sourceId, nc.canvas, nc.ctx);
      if (hadAudio && sourceChanged) this._startDesktopAudio(choice.sourceId);
      return;
    }

    // Audio toggled → internal restart (stop without the onScreenShareStop
    // callback so the local "I'm sharing" UI state stays on).
    this._nativeCaptureCleanup?.();
    this._nativeCaptureCleanup = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.broadcast({ type: "screenshare_stop", from: this.userId });

    const stream = await this._startNativeScreenCapture(choice);
    this.screenStream = stream;
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) videoTrack.contentHint = "detail";
    await this.broadcast({ type: "screenshare_start", from: this.userId });
  }

  /**
   * Re-apply quality/resolution/fps from the settings store to the running
   * native capture — takes effect immediately, no renegotiation.
   */
  async applyNativeCaptureSettings(): Promise<void> {
    const nc = this._nativeCapture;
    if (!nc) return;
    await this._startNativePush(nc.sourceId, nc.canvas, nc.ctx);
  }

  private async _startNativeScreenCapture(presetChoice?: PickResult): Promise<MediaStream> {
    // Ask the user which monitor/window to share (+ whether to include desktop
    // audio) via our own picker — there's no OS-level getDisplayMedia picker here.
    // `presetChoice` skips the picker (used by mid-share restarts).
    let choice = presetChoice ?? null;
    if (!choice) {
      const sources = await invoke<CaptureSource[]>("list_capture_sources").catch(() => []);
      choice = await useScreenPickerStore.getState().requestPick(sources);
    }
    if (!choice) {
      // User dismissed the picker → mirror getDisplayMedia's cancel so the caller
      // stays silent instead of showing a "couldn't start" toast.
      throw new DOMException("User cancelled screen share", "AbortError");
    }
    const sourceId = choice.sourceId;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Native screen capture is unavailable on this system");

    if (!(await this._startNativePush(sourceId, canvas, ctx))) {
      invoke("screen_capture_stop").catch(() => {});
      throw new Error("Native screen capture produced no frames");
    }
    this._nativeCapture = { canvas, ctx, sourceId, withAudio: choice.withAudio };

    // No fps argument: capture every draw — the Rust loop's pacing decides the
    // actual rate, so fps changes mid-share need no new track.
    const track = canvas.captureStream().getVideoTracks()[0];
    const stream = new MediaStream([track]);

    // Optional desktop audio: Rust captures it (the whole sink via parec on
    // Linux; the shared window's app, or everything but blok for a monitor, via
    // WASAPI process loopback on Windows) and fans it out to peers over the
    // transport directly — no local playback (the user already hears it) and no
    // MediaStream plumbing.
    if (choice.withAudio) this._startDesktopAudio(sourceId);

    this._nativeCaptureCleanup = () => {
      invoke("screen_capture_stop").catch(() => {});
      this._nativeCapture = null;
      track.stop();
      if (choice.withAudio) invoke("desktop_audio_stop").catch(() => {});
    };
    return stream;
  }

  /**
   * Start (or retarget — the command stops any running capture first) desktop
   * audio for `sourceId`. On Windows a window source records only that window's
   * app, so the capture has to follow the source. Non-fatal on failure, but the
   * flag has to come back down so the picker and a later source switch don't
   * claim audio that isn't running.
   */
  private _startDesktopAudio(sourceId: string): void {
    const onChunk = new Channel<ArrayBuffer>(); // unused; command requires it
    invoke("desktop_audio_start", { onChunk, sourceId }).catch((e) => {
      if (this._nativeCapture) this._nativeCapture.withAudio = false;
      useToastStore.getState().showToast({
        icon: WifiOff,
        title: translate("screenShare.desktopAudioUnavailable"),
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }

  async stopScreenShare(): Promise<void> {
    this._nativeCaptureCleanup?.();
    this._nativeCaptureCleanup = null;
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    await this.broadcast({ type: "screenshare_stop", from: this.userId });
    this.cb.onScreenShareStop?.(this.userId);
  }

  isCameraOn(): boolean {
    return this._cameraStream !== null;
  }

  async startCamera(): Promise<void> {
    if (this._cameraStream) return;
    const { cameraDevice, cameraQuality } = useUiSettingsStore.getState();
    const qualityMap: Record<string, { width: number; height: number }> = {
      "720p":  { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
      "1440p": { width: 2560, height: 1440 },
    };
    const dims = qualityMap[cameraQuality] ?? qualityMap["1080p"];
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: dims.width },
      height: { ideal: dims.height },
      ...(cameraDevice ? { deviceId: { exact: cameraDevice } } : {}),
    };
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    this._cameraStream = stream;
    this.cb.onVideoStart?.(this.userId, stream); // local self-preview
    await this.broadcast({ type: "video_start", from: this.userId });
    this._startCameraEncode(stream);
  }

  async stopCamera(): Promise<void> {
    if (!this._cameraStream) return;
    this._stopCameraEncode();
    this._cameraStream.getTracks().forEach((t) => t.stop());
    this._cameraStream = null;
    await this.broadcast({ type: "video_stop", from: this.userId });
    this.cb.onVideoStop?.(this.userId);
  }

  // Camera frames ride the same native transport as screen share: draw the
  // getUserMedia stream to a hidden canvas ~15fps, JPEG-encode via toBlob, and
  // ship each frame to peers tagged as camera. getUserMedia itself works on both
  // OSes (only RTCPeerConnection is missing on Linux), so capture is unchanged.
  private _cameraEncodeStop: (() => void) | null = null;

  private _startCameraEncode(stream: MediaStream): void {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { screenShareQuality } = useUiSettingsStore.getState();
    const quality = SCREEN_QUALITY_TO_JPEG[screenShareQuality] ?? 0.7;
    let busy = false;
    const interval = setInterval(() => {
      if (busy || video.videoWidth === 0) return;
      busy = true;
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { busy = false; return; }
          blob.arrayBuffer()
            .then((buf) =>
              invoke("rtc_broadcast_video", new Uint8Array(buf), {
                headers: { "x-tag": "camera", "x-w": String(canvas.width), "x-h": String(canvas.height) },
              }),
            )
            .catch(() => {})
            .finally(() => { busy = false; });
        },
        "image/jpeg",
        quality,
      );
    }, 1000 / 15);
    this._cameraEncodeStop = () => { clearInterval(interval); video.srcObject = null; };
  }

  private _stopCameraEncode(): void {
    this._cameraEncodeStop?.();
    this._cameraEncodeStop = null;
  }

  // ── Signal handling ─────────────────────────────────────────────────────────

  private async handleSignal(msg: NativeSignalMsg): Promise<void> {
    if (!msg || !msg.from) return;
    if (msg.from === this.userId) return;

    switch (msg.type) {
      case "join":
        this.cb.onParticipantJoin(msg.from, true);
        await this.broadcast({ type: "hello", from: this.userId });
        this._ensureRtcPeer(msg.from);
        if (this.isScreenSharing()) {
          await this.broadcast({ type: "screenshare_start", from: this.userId });
        }
        if (this._cameraStream) {
          await this.broadcast({ type: "video_start", from: this.userId });
        }
        break;
      case "hello":
        this.cb.onParticipantJoin(msg.from, false);
        this._ensureRtcPeer(msg.from);
        break;
      case "leave":
        this.cb.onParticipantLeave(msg.from);
        this.clearPeerSpeaking(msg.from);
        this._closeRtcPeer(msg.from);
        this._teardownRemoteVideo(msg.from, 1);
        this._teardownRemoteVideo(msg.from, 2);
        break;
      case "rtc_offer":
      case "rtc_answer":
      case "rtc_ice": {
        if (msg.to !== this.userId) break;
        // An incoming offer always means the remote (re)created its peer — a
        // fresh DTLS session. Recreate ours as responder before applying it
        // (Rust's CreatePeer replaces any existing peer for this id).
        if (msg.type === "rtc_offer") {
          this._rtcPeers.add(msg.from);
          await invoke("rtc_create_peer", { peerId: msg.from, initiator: false }).catch(() => {});
        }
        const kind = msg.type === "rtc_offer" ? "offer" : msg.type === "rtc_answer" ? "answer" : "ice";
        await invoke("rtc_signal_remote", { peerId: msg.from, kind, payload: msg.payload }).catch(() => {});
        break;
      }
      // Screen-share / camera are now pure presence signals — the actual frames
      // ride the native transport's video data channel (see _onRtcVideoFrame).
      case "screenshare_start":
        // Frames create the stream on arrival; nothing to set up here.
        break;
      case "screenshare_stop":
        this._teardownRemoteVideo(msg.from, 1);
        this.cb.onScreenShareStop?.(msg.from);
        break;
      case "video_start":
        break;
      case "video_stop":
        this._teardownRemoteVideo(msg.from, 2);
        this.cb.onVideoStop?.(msg.from);
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
