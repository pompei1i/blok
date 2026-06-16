import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { supabase } from "./supabaseClient";
import type { VoiceCallbacks } from "./voice-engine";
import { useUiSettingsStore } from "./store/ui-settings-store";
import { useToastStore } from "./store/toast-store";
import { SCREEN_RES_TO_MAX_WIDTH, SCREEN_QUALITY_TO_JPEG } from "./constants";

type NativeSignalMsg =
  | { type: "join"; from: string }
  | { type: "hello"; from: string }
  | { type: "leave"; from: string }
  | { type: "audio"; from: string; data: string; rate?: number }
  | { type: "speaking"; from: string; speaking: boolean }
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

const ICE_CONFIG: RTCConfiguration = { iceServers: buildIceServers() };

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
    emoji: "📵",
    title: "Video couldn't connect",
    message: "Screen share / camera failed to establish a connection (TURN relay).",
  });
}

function attachPcDiagnostics(pc: RTCPeerConnection, label: string): void {
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === "failed" || s === "disconnected") {
      console.warn(`[voice] ${label}: ICE ${s} — media can't connect. Check TURN (set VITE_TURN_URLS/USERNAME/CREDENTIAL).`);
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

function int16ToBase64(samples: number[]): string {
  const bytes = new Uint8Array(new Int16Array(samples).buffer);
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

  // Screen share — sender side
  private _screenCaptureTimer: ReturnType<typeof setTimeout> | null = null;
  private _captureInFlight = false;
  private _windowMoving = false;
  private _windowMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private _unlistenWindowMove: UnlistenFn | null = null;
  private _screenVideoEl: HTMLVideoElement | null = null;
  private _screenCanvasEl: HTMLCanvasElement | null = null;
  // Most recent packed frame ([w][h][jpeg]). Re-sent to each viewer the instant
  // their DataChannel opens, so late joiners (or anyone watching static content,
  // where the Rust capture dedups identical frames) get a picture immediately
  // instead of a black screen until the shared content next changes.
  private _lastScreenFrame: ArrayBuffer | null = null;

  // Screen share — receiver side: one canvas+stream per remote peer
  private _remoteCanvases = new Map<string, { canvas: HTMLCanvasElement; stream: MediaStream }>();
  // Receiver-side frame decode coalescing: keep only the newest undecoded frame
  // per sharer and decode one at a time, so a backlog can never paint an old
  // frame over a newer one or pile up createImageBitmap work at high FPS.
  private _pendingFrames = new Map<string, ArrayBuffer>();
  private _decodingFrames = new Set<string>();

  // WebRTC: sharer side — one PC+DC per viewer
  private _shareePcs = new Map<string, RTCPeerConnection>();
  private _shareeChannels = new Map<string, RTCDataChannel>();

  // WebRTC: viewer side — one PC per sharer
  private _viewerPcs = new Map<string, RTCPeerConnection>();

  // Camera video — sender side: one PC per viewer
  private _videoSenderPcs = new Map<string, RTCPeerConnection>();
  // Camera video — receiver side: one PC per sender
  private _videoReceiverPcs = new Map<string, RTCPeerConnection>();
  private _cameraStream: MediaStream | null = null;

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

    this.unlistenChunk = await listen<number[]>("audio-chunk", (event) => {
      if (!this.realtimeCh || !this._subscribed) return;
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
    if (this._screenCaptureTimer !== null || this._screenVideoEl) {
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
    for (const id of [...this._shareePcs.keys()]) this._closeShareePc(id);
    for (const id of [...this._viewerPcs.keys()]) this._closeViewerPc(id);
    for (const id of [...this._videoSenderPcs.keys()]) this._closeVideoSenderPc(id);
    for (const id of [...this._videoReceiverPcs.keys()]) this._closeVideoReceiverPc(id);
    if (this._cameraStream) { this._cameraStream.getTracks().forEach((t) => t.stop()); this._cameraStream = null; }

    for (const { stream } of this._remoteCanvases.values()) {
      stream.getTracks().forEach((t) => t.stop());
    }
    this._remoteCanvases.clear();
    this._pendingFrames.clear();
    this._decodingFrames.clear();

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

  isScreenSharing(): boolean {
    return this._screenCaptureTimer !== null || this._screenVideoEl !== null;
  }

  async startScreenShare(sourceId?: string): Promise<void> {
    if (this._screenCaptureTimer !== null) return;

    const { screenShareFps, screenShareResolution, screenShareQuality } = useUiSettingsStore.getState();
    const intervalMs = Math.round(1000 / screenShareFps);
    const maxWidth = SCREEN_RES_TO_MAX_WIDTH[screenShareResolution];
    const jpegQuality = SCREEN_QUALITY_TO_JPEG[screenShareQuality];
    const jpegQualityRust = Math.round(jpegQuality * 100) as number;

    if (sourceId && "__TAURI_INTERNALS__" in window) {
      // Pause GDI capture while the window is being dragged — BitBlt competes
      // with DWM during moves and causes visible frame drops in the UI.
      listen("tauri://move", () => {
        this._windowMoving = true;
        if (this._windowMoveTimer) clearTimeout(this._windowMoveTimer);
        this._windowMoveTimer = setTimeout(() => {
          this._windowMoving = false;
          this._windowMoveTimer = null;
        }, 150);
      }).then((unlisten) => {
        // listen() is async: if sharing was already stopped before it resolved,
        // detach immediately instead of leaking the listener for the app's life.
        if (this._screenCaptureTimer === null) { unlisten(); return; }
        this._unlistenWindowMove = unlisten;
      }).catch(() => {});

      const step = () => {
        if (this._screenCaptureTimer === null) return;
        if (this._captureInFlight || this._windowMoving) {
          this._screenCaptureTimer = setTimeout(step, intervalMs);
          return;
        }
        this._captureInFlight = true;
        const t0 = performance.now();
        invoke<{ data: string; w: number; h: number } | null>(
          "capture_screen_frame", { sourceId, maxWidth, jpegQuality: jpegQualityRust }
        ).then((frame) => {
          if (frame && this._screenCaptureTimer !== null) {
            this._sendFrameViaDC(frame.w, frame.h, frame.data);
          }
        }).catch(() => {}).finally(() => {
          this._captureInFlight = false;
          if (this._screenCaptureTimer !== null) {
            const wait = Math.max(0, intervalMs - (performance.now() - t0));
            this._screenCaptureTimer = setTimeout(step, wait);
          }
        });
      };
      this._screenCaptureTimer = setTimeout(step, 0);
      await this.broadcast({ type: "screenshare_start", from: this.userId });
      this.cb.onScreenShareStart?.(this.userId, new MediaStream());
      return;
    }

    // Browser fallback: getDisplayMedia
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { width: { max: maxWidth > 0 ? maxWidth : 3840 }, frameRate: { max: screenShareFps } },
    });

    this.screenStream = stream;

    // The browser's own "Stop sharing" control ends the track without going
    // through our UI — react to it so state stays consistent with reality.
    const [displayTrack] = stream.getVideoTracks();
    if (displayTrack) {
      displayTrack.addEventListener("ended", () => { void this.stopScreenShare(); }, { once: true });
    }

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await new Promise<void>((res) => {
      video.onloadedmetadata = () => { void video.play().then(res); };
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    this._screenVideoEl = video;
    this._screenCanvasEl = canvas;

    const stepBrowser = () => {
      if (this._screenCaptureTimer === null) return;
      if (!this._screenVideoEl || !this._screenCanvasEl) return;
      const t0 = performance.now();
      const w = this._screenVideoEl.videoWidth;
      const h = this._screenVideoEl.videoHeight;
      if (!w || !h) {
        const wait = Math.max(0, intervalMs - (performance.now() - t0));
        this._screenCaptureTimer = setTimeout(stepBrowser, wait);
        return;
      }
      const scale = maxWidth > 0 && w > maxWidth ? maxWidth / w : 1;
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      if (canvas.width !== tw) canvas.width = tw;
      if (canvas.height !== th) canvas.height = th;
      ctx.drawImage(this._screenVideoEl, 0, 0, tw, th);
      const data = canvas.toDataURL("image/jpeg", jpegQuality).split(",")[1];
      this._sendFrameViaDC(tw, th, data);
      const wait = Math.max(0, intervalMs - (performance.now() - t0));
      this._screenCaptureTimer = setTimeout(stepBrowser, wait);
    };
    this._screenCaptureTimer = setTimeout(stepBrowser, 0);

    await this.broadcast({ type: "screenshare_start", from: this.userId });
    this.cb.onScreenShareStart?.(this.userId, stream);
  }

  async stopScreenShare(): Promise<void> {
    if (this._screenCaptureTimer) {
      clearTimeout(this._screenCaptureTimer);
      this._screenCaptureTimer = null;
    }
    this._captureInFlight = false;
    this._unlistenWindowMove?.();
    this._unlistenWindowMove = null;
    if (this._windowMoveTimer) { clearTimeout(this._windowMoveTimer); this._windowMoveTimer = null; }
    this._windowMoving = false;
    if (this._screenVideoEl) {
      this._screenVideoEl.srcObject = null;
      this._screenVideoEl = null;
    }
    this._screenCanvasEl = null;
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this._lastScreenFrame = null;
    // Close all viewer peer connections (we were the sharer)
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

  /** Pack JPEG frame as [w:u32][h:u32][jpeg bytes] and send to all open viewer DCs. */
  private _sendFrameViaDC(w: number, h: number, jpegBase64: string): void {
    const jpeg = Uint8Array.from(atob(jpegBase64), (c) => c.charCodeAt(0));
    const payload = new Uint8Array(8 + jpeg.length);
    const dv = new DataView(payload.buffer);
    dv.setUint32(0, w, false);
    dv.setUint32(4, h, false);
    payload.set(jpeg, 8);
    // Cache the latest frame even when nobody is connected yet, so a viewer whose
    // DataChannel opens after this point still receives the current screen.
    this._lastScreenFrame = payload.buffer;
    for (const ch of this._shareeChannels.values()) {
      // Skip frame if the DC send buffer is backed up (previous frame not yet drained).
      // 1 MB threshold (raised from 256 KB in v0.9.12): high-quality frames can
      // exceed 256 KB, which made every frame get dropped → black screen.
      if (ch.readyState !== "open" || ch.bufferedAmount > 1_000_000) continue;
      try { ch.send(payload.buffer); } catch { /* ignore */ }
    }
  }

  /** Decode an incoming binary frame and paint it onto the sharer's canvas. */
  private _onScreenFrame(sharerId: string, data: ArrayBuffer): void {
    const entry = this._remoteCanvases.get(sharerId);
    if (!entry || data.byteLength < 8) return;
    if (data.byteLength - 8 > 4_000_000) return;
    const dv = new DataView(data);
    const fw = Math.min(dv.getUint32(0, false), 3840);
    const fh = Math.min(dv.getUint32(4, false), 2160);
    const { canvas } = entry;
    // Resize synchronously from the header (cheap, needs no decode). Done here so
    // dimensions are correct even if the async decode below is coalesced away.
    if (canvas.width !== fw) canvas.width = fw;
    if (canvas.height !== fh) canvas.height = fh;
    // Keep only the newest frame per sharer; the drain loop paints it once the
    // current decode (if any) finishes — newer frames supersede older ones.
    this._pendingFrames.set(sharerId, data);
    if (!this._decodingFrames.has(sharerId)) {
      void this._drainFrames(sharerId).catch(() => {});
    }
  }

  /** Decode and paint queued frames for one sharer, one at a time, newest-wins. */
  private async _drainFrames(sharerId: string): Promise<void> {
    if (typeof createImageBitmap !== "function") {
      // No async image decoder (e.g. test env) — drop the queue; the synchronous
      // canvas resize in _onScreenFrame already ran.
      this._pendingFrames.delete(sharerId);
      return;
    }
    this._decodingFrames.add(sharerId);
    try {
      let data: ArrayBuffer | undefined;
      while ((data = this._pendingFrames.get(sharerId)) !== undefined) {
        this._pendingFrames.delete(sharerId);
        const entry = this._remoteCanvases.get(sharerId);
        if (!entry) break;
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(new Blob([new Uint8Array(data, 8)], { type: "image/jpeg" }));
        } catch {
          continue; // corrupt/partial frame — skip, next one will repaint
        }
        // The viewer may have stopped watching while we were decoding.
        const cur = this._remoteCanvases.get(sharerId);
        if (!cur) { bitmap.close(); break; }
        const ctx = cur.canvas.getContext("2d");
        ctx?.drawImage(bitmap, 0, 0, cur.canvas.width, cur.canvas.height);
        bitmap.close();
        const track = cur.stream.getVideoTracks()[0] as
          (CanvasCaptureMediaStreamTrack & { requestFrame?(): void }) | undefined;
        track?.requestFrame?.();
      }
    } finally {
      this._decodingFrames.delete(sharerId);
    }
  }

  /** Viewer: initiate WebRTC connection to a sharer. */
  private async _setupViewerPc(sharerId: string): Promise<void> {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._viewerPcs.set(sharerId, pc);
    attachPcDiagnostics(pc, `screen-viewer→${sharerId.slice(0, 8)}`);

    const dc = pc.createDataChannel("screen", { ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    dc.onmessage = (e) => this._onScreenFrame(sharerId, e.data as ArrayBuffer);

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
    this._closeShareePc(viewerId);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._shareePcs.set(viewerId, pc);
    attachPcDiagnostics(pc, `screen-sharer→${viewerId.slice(0, 8)}`);

    pc.ondatachannel = ({ channel }) => {
      channel.binaryType = "arraybuffer";
      this._shareeChannels.set(viewerId, channel);
      channel.onclose = () => this._shareeChannels.delete(viewerId);
      // Push the current frame as soon as the channel is usable so the viewer
      // doesn't wait for the next content change (which may never come).
      const sendInitial = () => {
        if (channel.readyState === "open" && this._lastScreenFrame) {
          try { channel.send(this._lastScreenFrame); } catch { /* ignore */ }
        }
      };
      if (channel.readyState === "open") sendInitial();
      else channel.onopen = sendInitial;
    };

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
    this._shareeChannels.get(viewerId)?.close();
    this._shareeChannels.delete(viewerId);
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
    const pc = new RTCPeerConnection(ICE_CONFIG);
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

    const pc = new RTCPeerConnection(ICE_CONFIG);
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
        this.cb.onParticipantJoin(msg.from);
        await this.broadcast({ type: "hello", from: this.userId });
        if (this.isScreenSharing()) {
          await this.broadcast({ type: "screenshare_start", from: this.userId });
        }
        if (this._cameraStream) {
          await this.broadcast({ type: "video_start", from: this.userId });
        }
        break;
      case "hello":
        this.cb.onParticipantJoin(msg.from);
        break;
      case "leave":
        this.cb.onParticipantLeave(msg.from);
        this.clearPeerSpeaking(msg.from);
        invoke("audio_remove_peer", { peerId: msg.from }).catch(() => {});
        this._closeShareePc(msg.from);
        this._closeViewerPc(msg.from);
        this._clearRemoteCanvas(msg.from);
        this._closeVideoSenderPc(msg.from);
        this._closeVideoReceiverPc(msg.from);
        break;
      case "audio": {
        if (this._localMuted.has(msg.from)) break;
        const raw = base64ToInt16Array(msg.data);
        const vol = (this._userVolumes.get(msg.from) ?? 100) / 100;
        const samples = vol === 1 ? raw : raw.map(s => Math.max(-32768, Math.min(32767, Math.round(s * vol))));
        const speaking = await invoke<boolean>("audio_receive", { from: msg.from, samples, rate: msg.rate ?? 48000 });
        this.updateSpeaking(msg.from, speaking);
        break;
      }
      case "speaking":
        // Ignored: remote speaking state is driven by audio_receive return value (in sync with playback).
        break;
      case "screenshare_start": {
        // A sharer re-broadcasts screenshare_start whenever anyone new joins the
        // channel. If we're already viewing this sharer over a healthy peer
        // connection, ignore it — tearing down and rebuilding would black-screen
        // the viewer every time a third party joins. A genuine re-share is always
        // preceded by screenshare_stop, which clears the connection first.
        const existingPc = this._viewerPcs.get(msg.from);
        if (
          existingPc &&
          this._remoteCanvases.has(msg.from) &&
          existingPc.connectionState !== "failed" &&
          existingPc.connectionState !== "disconnected" &&
          existingPc.connectionState !== "closed"
        ) {
          break;
        }
        this._clearRemoteCanvas(msg.from);
        this._closeViewerPc(msg.from);
        this._pendingViewerIce.delete(msg.from);
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(0);
        this._remoteCanvases.set(msg.from, { canvas, stream });
        this.cb.onScreenShareStart?.(msg.from, stream);
        await this._setupViewerPc(msg.from);
        break;
      }
      case "screenshare_stop":
        this._pendingViewerIce.delete(msg.from);
        this._closeViewerPc(msg.from);
        this._clearRemoteCanvas(msg.from);
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

  private _clearRemoteCanvas(peerId: string): void {
    const entry = this._remoteCanvases.get(peerId);
    if (entry) {
      entry.stream.getTracks().forEach((t) => t.stop());
      this._remoteCanvases.delete(peerId);
    }
    this._pendingFrames.delete(peerId);
    this._decodingFrames.delete(peerId);
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
