import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { supabase } from "./supabaseClient";
import type { VoiceCallbacks } from "./voice-types";
import { WifiOff } from "lucide-react";
import { useUiSettingsStore } from "./store/ui-settings-store";
import { useToastStore } from "./store/toast-store";

type NativeSignalMsg =
  | { type: "join"; from: string }
  | { type: "hello"; from: string }
  | { type: "leave"; from: string }
  | { type: "audio_offer"; from: string; to: string; sdp: string }
  | { type: "audio_answer"; from: string; to: string; sdp: string }
  | { type: "audio_ice"; from: string; to: string; candidate: RTCIceCandidateInit }
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
// networks) — without a working relay, screen share / camera PCs never connect
// and the viewer just sees a black screen (audio still works: it goes over the
// Supabase realtime broadcast, not WebRTC). Provide a real TURN via env:
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

  return await new Promise<TurnTestResult>((resolve) => {
    const pc = new RTCPeerConnection(config);
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

/**
 * Surface ICE/connection failures that would otherwise be silent (the symptom is
 * just a black video). Logs the state transitions for each media PeerConnection.
 */
// Throttle so 4 simultaneous PCs failing don't stack 4 identical toasts.
let _lastIceFailToast = 0;
function _notifyIceFailure(): void {
  const now = Date.now();
  if (now - _lastIceFailToast < 8000) return;
  _lastIceFailToast = now;
  useToastStore.getState().showToast({
    icon: WifiOff,
    title: "Video couldn't connect",
    message: "Screen share / camera failed to establish a connection (TURN relay).",
  });
}

function attachPcDiagnostics(pc: RTCPeerConnection, label: string): void {
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === "failed" || s === "disconnected") {
      console.warn(`[voice] ${label}: ICE ${s} — media can't connect. Check the TURN relay (Cloudflare creds via the 'turn' Edge Function, or VITE_TURN_*).`);
      if (s === "failed") _notifyIceFailure();
    } else {
      console.info(`[voice] ${label}: ICE ${s}`);
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      console.warn(`[voice] ${label}: connection failed`);
      _notifyIceFailure();
    }
  };
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

  // WebRTC: screen share — sharer side: one PC per viewer
  private _shareePcs = new Map<string, RTCPeerConnection>();

  // WebRTC: viewer side — one PC per sharer
  private _viewerPcs = new Map<string, RTCPeerConnection>();

  // Camera video — sender side: one PC per viewer
  private _videoSenderPcs = new Map<string, RTCPeerConnection>();
  // Camera video — receiver side: one PC per sender
  private _videoReceiverPcs = new Map<string, RTCPeerConnection>();
  private _cameraStream: MediaStream | null = null;

  // ── Voice audio transport: WebRTC DataChannel (P2P/TURN), not Supabase relay ──
  // Native Rust still captures/plays the PCM (good mic quality on WebView2); we
  // just carry it peer-to-peer over an unreliable/unordered DataChannel (UDP-like)
  // → low latency. One bidirectional PC+channel per peer; smaller userId offers.
  private _audioPcs = new Map<string, RTCPeerConnection>();
  private _audioChannels = new Map<string, RTCDataChannel>();
  private _pendingAudioIce = new Map<string, RTCIceCandidateInit[]>();

  // Per-user local controls (not synced to remote)
  private _userVolumes = new Map<string, number>();
  private _localMuted = new Set<string>();

  // ICE candidate queues — candidates that arrived before setRemoteDescription completed.
  // Keyed by peer id. Flushed immediately after each setRemoteDescription call.
  private _pendingViewerIce = new Map<string, RTCIceCandidateInit[]>();
  private _pendingShareeIce = new Map<string, RTCIceCandidateInit[]>();
  private _pendingVideoReceiverIce = new Map<string, RTCIceCandidateInit[]>();
  private _pendingVideoSenderIce = new Map<string, RTCIceCandidateInit[]>();

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
    this.localRate = await invoke<number>("audio_start", {
      inputDevice: inputDevice || null,
      outputDevice: outputDevice || null,
      noiseSuppression,
      echoCancellation,
    });
    invoke("disable_audio_ducking").catch(() => {});

    // Send each captured PCM frame peer-to-peer over the per-peer DataChannels
    // (binary, unreliable). No Supabase relay → low latency.
    this.unlistenChunk = await listen<number[]>("audio-chunk", (event) => {
      if (this._audioChannels.size === 0) return;
      const buf = new Int16Array(event.payload).buffer;
      for (const ch of this._audioChannels.values()) {
        if (ch.readyState === "open") {
          try { ch.send(buf); } catch { /* channel closing */ }
        }
      }
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

    try {
      await this.subscribePromise;
    } catch (err) {
      this.unlistenChunk?.(); this.unlistenChunk = null;
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

    this.unlistenChunk?.();
    this.unlistenChunk = null;
    this.unlistenSpeaking?.();
    this.unlistenSpeaking = null;

    for (const t of this.speakingTimers.values()) clearTimeout(t);
    this.speakingTimers.clear();
    this.speakingState.clear();

    // Close all WebRTC connections
    for (const id of [...this._audioPcs.keys()]) this._closeAudioPc(id);
    for (const id of [...this._shareePcs.keys()]) this._closeShareePc(id);
    for (const id of [...this._viewerPcs.keys()]) this._closeViewerPc(id);
    for (const id of [...this._videoSenderPcs.keys()]) this._closeVideoSenderPc(id);
    for (const id of [...this._videoReceiverPcs.keys()]) this._closeVideoReceiverPc(id);
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
  }

  setLocalMute(userId: string, muted: boolean): void {
    if (muted) this._localMuted.add(userId);
    else this._localMuted.delete(userId);
  }

  // ── Voice audio mesh (PCM over WebRTC DataChannel) ──────────────────────────

  /** Establish the audio PC with a peer. Smaller userId offers (avoids glare). */
  private _ensureAudioPc(peerId: string): void {
    if (this._audioPcs.has(peerId)) return;
    if (this.userId < peerId) void this._createAudioOffer(peerId);
    // else: wait for their audio_offer (their _ensureAudioPc offers to us).
  }

  private async _newAudioPc(peerId: string): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection(await getIceConfig());
    this._audioPcs.set(peerId, pc);
    attachPcDiagnostics(pc, `audio↔${peerId.slice(0, 8)}`);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "audio_ice", from: this.userId, to: peerId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };
    // Answerer receives the channel the offerer created.
    pc.ondatachannel = ({ channel }) => this._attachAudioChannel(peerId, channel);
    return pc;
  }

  private async _createAudioOffer(peerId: string): Promise<void> {
    const pc = await this._newAudioPc(peerId);
    // Offerer creates the unreliable/unordered (UDP-like) channel for low latency.
    this._attachAudioChannel(peerId, pc.createDataChannel("audio", { ordered: false, maxRetransmits: 0 }));
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.broadcast({ type: "audio_offer", from: this.userId, to: peerId, sdp: offer.sdp! });
    } catch {
      this._closeAudioPc(peerId);
    }
  }

  private async _handleAudioOffer(peerId: string, sdp: string): Promise<void> {
    this._closeAudioPc(peerId);
    const pc = await this._newAudioPc(peerId);
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      await this._flushIceQueue(pc, this._pendingAudioIce, peerId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.broadcast({ type: "audio_answer", from: this.userId, to: peerId, sdp: answer.sdp! });
    } catch {
      this._closeAudioPc(peerId);
    }
  }

  private async _handleAudioAnswer(peerId: string, sdp: string): Promise<void> {
    const pc = this._audioPcs.get(peerId);
    if (!pc) return;
    await pc.setRemoteDescription({ type: "answer", sdp });
    await this._flushIceQueue(pc, this._pendingAudioIce, peerId);
  }

  /** Wire a peer's audio DataChannel: incoming PCM → native playback. */
  private _attachAudioChannel(peerId: string, ch: RTCDataChannel): void {
    ch.binaryType = "arraybuffer";
    this._audioChannels.set(peerId, ch);
    ch.onmessage = (ev) => {
      if (this._localMuted.has(peerId)) return;
      const raw = Array.from(new Int16Array(ev.data as ArrayBuffer));
      const vol = (this._userVolumes.get(peerId) ?? 100) / 100;
      const samples = vol === 1 ? raw : raw.map((s) => Math.max(-32768, Math.min(32767, Math.round(s * vol))));
      void invoke<boolean>("audio_receive", { from: peerId, samples, rate: this.localRate })
        .then((speaking) => this.updateSpeaking(peerId, speaking))
        .catch(() => {});
    };
    ch.onclose = () => { if (this._audioChannels.get(peerId) === ch) this._audioChannels.delete(peerId); };
  }

  private _closeAudioPc(peerId: string): void {
    this._audioChannels.get(peerId)?.close();
    this._audioChannels.delete(peerId);
    this._audioPcs.get(peerId)?.close();
    this._audioPcs.delete(peerId);
    this._pendingAudioIce.delete(peerId);
    invoke("audio_remove_peer", { peerId }).catch(() => {});
    this.clearPeerSpeaking(peerId);
  }

  isScreenSharing(): boolean {
    return this.screenStream !== null;
  }

  async startScreenShare(): Promise<void> {
    if (this.screenStream) return;

    const { screenShareFps } = useUiSettingsStore.getState();
    const video = { frameRate: { ideal: screenShareFps } } as MediaTrackConstraints;
    // Real video (+ system audio) track over WebRTC. The OS picker lets the user
    // choose a screen, window or tab. Windows/Chromium can't capture audio for a
    // single *window*, and some WebView2 builds reject the whole request instead
    // of returning video-only — so on failure we retry without audio. A genuine
    // user-cancel (NotAllowedError/AbortError) is rethrown.
    // Called synchronously from the click gesture (no await before getDisplayMedia).
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) throw err;
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    }
    this.screenStream = stream;

    const [videoTrack] = stream.getVideoTracks();
    // Tell the encoder to favour sharpness over framerate — screen text/UI stays
    // crisp instead of getting smeared (the default "motion" hint blurs detail).
    if (videoTrack) videoTrack.contentHint = "detail";
    // The OS "Stop sharing" control ends the track outside our UI — sync state.
    videoTrack?.addEventListener("ended", () => { void this.stopScreenShare(); }, { once: true });

    await this.broadcast({ type: "screenshare_start", from: this.userId });
  }

  async stopScreenShare(): Promise<void> {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    // Close all viewer peer connections (we were the sharer).
    for (const id of [...this._shareePcs.keys()]) this._closeShareePc(id);
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
    await this.broadcast({ type: "video_start", from: this.userId });
    this.cb.onVideoStart?.(this.userId, stream);
  }

  async stopCamera(): Promise<void> {
    if (!this._cameraStream) return;
    this._cameraStream.getTracks().forEach((t) => t.stop());
    this._cameraStream = null;
    for (const id of [...this._videoSenderPcs.keys()]) this._closeVideoSenderPc(id);
    await this.broadcast({ type: "video_stop", from: this.userId });
    this.cb.onVideoStop?.(this.userId);
  }

  // ── ICE queue helpers ────────────────────────────────────────────────────────

  /**
   * Queue an ICE candidate if the PC has no remote description yet, otherwise
   * add it immediately. Candidates queued here are flushed by _flushIceQueue
   * right after the corresponding setRemoteDescription call completes.
   */
  private _queueOrAddIce(
    pc: RTCPeerConnection,
    candidate: RTCIceCandidateInit,
    queue: Map<string, RTCIceCandidateInit[]>,
    peerId: string,
  ): void {
    if (!pc.remoteDescription) {
      const pending = queue.get(peerId) ?? [];
      pending.push(candidate);
      queue.set(peerId, pending);
      return;
    }
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  }

  /** Drain queued ICE candidates after setRemoteDescription has completed. */
  private async _flushIceQueue(
    pc: RTCPeerConnection,
    queue: Map<string, RTCIceCandidateInit[]>,
    peerId: string,
  ): Promise<void> {
    const candidates = queue.get(peerId);
    if (!candidates?.length) return;
    queue.delete(peerId);
    for (const c of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  }

  // ── WebRTC helpers ───────────────────────────────────────────────────────────

  /** Viewer: initiate WebRTC connection to a sharer. */
  private async _setupViewerPc(sharerId: string): Promise<void> {
    const pc = new RTCPeerConnection(await getIceConfig());
    this._viewerPcs.set(sharerId, pc);
    attachPcDiagnostics(pc, `screen-viewer→${sharerId.slice(0, 8)}`);

    // Request the sharer's screen video + system audio.
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = ({ streams }) => {
      // Fires once media arrives → the overlay shows the live picture (not black).
      if (streams[0]) this.cb.onScreenShareStart?.(sharerId, streams[0]);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "screenshare_ice", from: this.userId, to: sharerId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.broadcast({ type: "screenshare_offer", from: this.userId, to: sharerId, sdp: offer.sdp! });
    } catch {
      this._pendingViewerIce.delete(sharerId);
      this._closeViewerPc(sharerId);
    }
  }

  /** Sharer: handle an offer from a viewer, send back an answer. */
  private async _handleShareeOffer(viewerId: string, sdp: string): Promise<void> {
    if (!this.screenStream) return;
    // Notify only on a genuinely new viewer — renegotiation re-sends an offer for
    // a viewer we already have a connection to, and shouldn't re-chime.
    const isNewViewer = !this._shareePcs.has(viewerId);
    this._closeShareePc(viewerId);
    if (isNewViewer) this.cb.onScreenWatched?.(viewerId);

    const pc = new RTCPeerConnection(await getIceConfig());
    this._shareePcs.set(viewerId, pc);
    attachPcDiagnostics(pc, `screen-sharer→${viewerId.slice(0, 8)}`);

    // Send our screen video + system audio tracks to this viewer.
    for (const track of this.screenStream.getTracks()) {
      pc.addTrack(track, this.screenStream);
    }

    // Raise the video bitrate ceiling so high-res screen content stays sharp —
    // WebRTC's ~2.5 Mbps default blurs text. Congestion control still scales down
    // on slow links, so this is a ceiling, not a floor.
    const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (videoSender) {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = 8_000_000;
      videoSender.setParameters(params).catch(() => {});
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "screenshare_ice", from: this.userId, to: viewerId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      // Flush any viewer ICE candidates that arrived before this setRemoteDescription.
      await this._flushIceQueue(pc, this._pendingShareeIce, viewerId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.broadcast({ type: "screenshare_answer", from: this.userId, to: viewerId, sdp: answer.sdp! });
    } catch {
      this._pendingShareeIce.delete(viewerId);
      this._closeShareePc(viewerId);
    }
  }

  private _closeShareePc(viewerId: string): void {
    this._shareePcs.get(viewerId)?.close();
    this._shareePcs.delete(viewerId);
    this._pendingShareeIce.delete(viewerId);
  }

  private _closeViewerPc(sharerId: string): void {
    this._viewerPcs.get(sharerId)?.close();
    this._viewerPcs.delete(sharerId);
    this._pendingViewerIce.delete(sharerId);
  }

  // ── Video WebRTC helpers ────────────────────────────────────────────────────

  /** Receiver: create PC that requests video from a remote camera sender. */
  private async _setupVideoReceiverPc(senderId: string): Promise<void> {
    this._closeVideoReceiverPc(senderId);
    const pc = new RTCPeerConnection(await getIceConfig());
    this._videoReceiverPcs.set(senderId, pc);
    attachPcDiagnostics(pc, `camera-receiver←${senderId.slice(0, 8)}`);

    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = ({ streams }) => {
      if (streams[0]) this.cb.onVideoStart?.(senderId, streams[0]);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "video_ice", from: this.userId, to: senderId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.broadcast({ type: "video_offer", from: this.userId, to: senderId, sdp: offer.sdp! });
    } catch {
      this._pendingVideoReceiverIce.delete(senderId);
      this._closeVideoReceiverPc(senderId);
    }
  }

  /** Sender: handle an offer from a viewer, answer with our camera track. */
  private async _handleVideoOffer(viewerId: string, sdp: string): Promise<void> {
    if (!this._cameraStream) return;
    this._closeVideoSenderPc(viewerId);

    const pc = new RTCPeerConnection(await getIceConfig());
    this._videoSenderPcs.set(viewerId, pc);
    attachPcDiagnostics(pc, `camera-sender→${viewerId.slice(0, 8)}`);

    for (const track of this._cameraStream.getVideoTracks()) {
      pc.addTrack(track, this._cameraStream);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "video_ice", from: this.userId, to: viewerId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      // Flush any viewer ICE candidates that arrived before this setRemoteDescription.
      await this._flushIceQueue(pc, this._pendingVideoSenderIce, viewerId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.broadcast({ type: "video_answer", from: this.userId, to: viewerId, sdp: answer.sdp! });
    } catch {
      this._pendingVideoSenderIce.delete(viewerId);
      this._closeVideoSenderPc(viewerId);
    }
  }

  private _closeVideoSenderPc(viewerId: string): void {
    this._videoSenderPcs.get(viewerId)?.close();
    this._videoSenderPcs.delete(viewerId);
    this._pendingVideoSenderIce.delete(viewerId);
  }

  private _closeVideoReceiverPc(senderId: string): void {
    this._videoReceiverPcs.get(senderId)?.close();
    this._videoReceiverPcs.delete(senderId);
    this._pendingVideoReceiverIce.delete(senderId);
  }

  // ── Signal handling ─────────────────────────────────────────────────────────

  private async handleSignal(msg: NativeSignalMsg): Promise<void> {
    if (!msg || !msg.from) return;
    if (msg.from === this.userId) return;

    switch (msg.type) {
      case "join":
        this.cb.onParticipantJoin(msg.from, true);
        await this.broadcast({ type: "hello", from: this.userId });
        this._ensureAudioPc(msg.from);
        if (this.isScreenSharing()) {
          await this.broadcast({ type: "screenshare_start", from: this.userId });
        }
        if (this._cameraStream) {
          await this.broadcast({ type: "video_start", from: this.userId });
        }
        break;
      case "hello":
        this.cb.onParticipantJoin(msg.from, false);
        this._ensureAudioPc(msg.from);
        break;
      case "leave":
        this.cb.onParticipantLeave(msg.from);
        this.clearPeerSpeaking(msg.from);
        this._closeAudioPc(msg.from);
        this._closeShareePc(msg.from);
        this._closeViewerPc(msg.from);
        this._closeVideoSenderPc(msg.from);
        this._closeVideoReceiverPc(msg.from);
        break;
      case "audio_offer":
        if (msg.to !== this.userId) break;
        await this._handleAudioOffer(msg.from, msg.sdp);
        break;
      case "audio_answer":
        if (msg.to !== this.userId) break;
        await this._handleAudioAnswer(msg.from, msg.sdp);
        break;
      case "audio_ice": {
        if (msg.to !== this.userId) break;
        const apc = this._audioPcs.get(msg.from);
        if (apc) this._queueOrAddIce(apc, msg.candidate, this._pendingAudioIce, msg.from);
        break;
      }
      case "screenshare_start": {
        // A sharer re-broadcasts screenshare_start whenever anyone new joins the
        // channel. If we already have a healthy viewer connection, ignore it —
        // rebuilding would interrupt the live stream. A genuine re-share is
        // always preceded by screenshare_stop, which clears the connection.
        const existingPc = this._viewerPcs.get(msg.from);
        if (
          existingPc &&
          existingPc.connectionState !== "failed" &&
          existingPc.connectionState !== "disconnected" &&
          existingPc.connectionState !== "closed"
        ) {
          break;
        }
        this._closeViewerPc(msg.from);
        this._pendingViewerIce.delete(msg.from);
        // onScreenShareStart fires from ontrack once media arrives (_setupViewerPc).
        await this._setupViewerPc(msg.from);
        break;
      }
      case "screenshare_stop":
        this._pendingViewerIce.delete(msg.from);
        this._closeViewerPc(msg.from);
        this.cb.onScreenShareStop?.(msg.from);
        break;
      case "screenshare_offer":
        if (msg.to !== this.userId) break;
        await this._handleShareeOffer(msg.from, msg.sdp);
        break;
      case "screenshare_answer": {
        if (msg.to !== this.userId) break;
        const pc = this._viewerPcs.get(msg.from);
        if (pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
          // Flush sharer ICE candidates that arrived before this answer was processed.
          await this._flushIceQueue(pc, this._pendingViewerIce, msg.from);
        }
        break;
      }
      case "screenshare_ice": {
        if (msg.to !== this.userId) break;
        const viewerPc = this._viewerPcs.get(msg.from);
        if (viewerPc) {
          this._queueOrAddIce(viewerPc, msg.candidate, this._pendingViewerIce, msg.from);
          break;
        }
        const shareePc = this._shareePcs.get(msg.from);
        if (shareePc) {
          this._queueOrAddIce(shareePc, msg.candidate, this._pendingShareeIce, msg.from);
        }
        break;
      }
      case "video_start":
        this._pendingVideoReceiverIce.delete(msg.from);
        this._closeVideoReceiverPc(msg.from);
        await this._setupVideoReceiverPc(msg.from);
        break;
      case "video_stop":
        this._pendingVideoReceiverIce.delete(msg.from);
        this._closeVideoReceiverPc(msg.from);
        this.cb.onVideoStop?.(msg.from);
        break;
      case "video_offer":
        if (msg.to !== this.userId) break;
        await this._handleVideoOffer(msg.from, msg.sdp);
        break;
      case "video_answer": {
        if (msg.to !== this.userId) break;
        const vpc = this._videoReceiverPcs.get(msg.from);
        if (vpc) {
          await vpc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
          // Flush sender ICE candidates that arrived before this answer was processed.
          await this._flushIceQueue(vpc, this._pendingVideoReceiverIce, msg.from);
        }
        break;
      }
      case "video_ice": {
        if (msg.to !== this.userId) break;
        const vReceiverPc = this._videoReceiverPcs.get(msg.from);
        if (vReceiverPc) {
          this._queueOrAddIce(vReceiverPc, msg.candidate, this._pendingVideoReceiverIce, msg.from);
          break;
        }
        const vSenderPc = this._videoSenderPcs.get(msg.from);
        if (vSenderPc) {
          this._queueOrAddIce(vSenderPc, msg.candidate, this._pendingVideoSenderIce, msg.from);
        }
        break;
      }
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
