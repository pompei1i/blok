import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { supabase } from "./supabaseClient";
import type { VoiceCallbacks } from "./voice-engine";
import { useUiSettingsStore } from "./store/ui-settings-store";
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

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

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

  private _lastSpeaking = false;

  // Screen share — sender side
  private _screenCaptureTimer: ReturnType<typeof setTimeout> | null = null;
  private _captureInFlight = false;
  private _windowMoving = false;
  private _windowMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private _unlistenWindowMove: UnlistenFn | null = null;
  private _screenVideoEl: HTMLVideoElement | null = null;
  private _screenCanvasEl: HTMLCanvasElement | null = null;

  // Screen share — receiver side: one canvas+stream per remote peer
  private _remoteCanvases = new Map<string, { canvas: HTMLCanvasElement; stream: MediaStream }>();

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
      if (event.payload !== this._lastSpeaking) {
        this._lastSpeaking = event.payload;
        this.broadcast({ type: "speaking", from: this.userId, speaking: event.payload }).catch(() => {});
      }
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
      }).then((unlisten) => { this._unlistenWindowMove = unlisten; }).catch(() => {});

      const step = () => {
        if (this._screenCaptureTimer === null) return;
        if (this._captureInFlight || this._windowMoving) {
          this._screenCaptureTimer = setTimeout(step, intervalMs);
          return;
        }
        this._captureInFlight = true;
        const t0 = performance.now();
        console.time("capture");
        invoke<{ data: string; w: number; h: number } | null>(
          "capture_screen_frame", { sourceId, maxWidth, jpegQuality: jpegQualityRust }
        ).then((frame) => {
          if (frame && this._screenCaptureTimer !== null) {
            this._sendFrameViaDC(frame.w, frame.h, frame.data);
          }
        }).catch(() => {}).finally(() => {
          console.timeEnd("capture");
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

  // ── WebRTC helpers ───────────────────────────────────────────────────────────

  /** Pack JPEG frame as [w:u32][h:u32][jpeg bytes] and send to all open viewer DCs. */
  private _sendFrameViaDC(w: number, h: number, jpegBase64: string): void {
    if (this._shareeChannels.size === 0) return;
    const jpeg = Uint8Array.from(atob(jpegBase64), (c) => c.charCodeAt(0));
    const payload = new Uint8Array(8 + jpeg.length);
    const dv = new DataView(payload.buffer);
    dv.setUint32(0, w, false);
    dv.setUint32(4, h, false);
    payload.set(jpeg, 8);
    for (const ch of this._shareeChannels.values()) {
      // Skip frame if the DC send buffer is backed up (previous frame not yet drained).
      // 256 KB threshold gives one frame of headroom before dropping.
      if (ch.readyState !== "open" || ch.bufferedAmount > 256_000) continue;
      try { ch.send(payload.buffer); } catch { /* ignore */ }
    }
  }

  /** Decode an incoming binary frame and paint it onto the sharer's canvas. */
  private _onScreenFrame(sharerId: string, data: ArrayBuffer): void {
    const entry = this._remoteCanvases.get(sharerId);
    if (!entry || data.byteLength < 8) return;
    const dv = new DataView(data);
    const fw = Math.min(dv.getUint32(0, false), 3840);
    const fh = Math.min(dv.getUint32(4, false), 2160);
    if (data.byteLength - 8 > 400_000) return;
    const { canvas, stream } = entry;
    if (canvas.width !== fw) canvas.width = fw;
    if (canvas.height !== fh) canvas.height = fh;
    const blob = new Blob([new Uint8Array(data, 8)], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      const track = stream.getVideoTracks()[0] as (CanvasCaptureMediaStreamTrack & { requestFrame?(): void }) | undefined;
      track?.requestFrame?.();
    };
    img.src = url;
  }

  /** Viewer: initiate WebRTC connection to a sharer. */
  private async _setupViewerPc(sharerId: string): Promise<void> {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._viewerPcs.set(sharerId, pc);

    // Viewer is offerer and creates the data channel
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
      this._closeViewerPc(sharerId);
    }
  }

  /** Sharer: handle an offer from a viewer, send back an answer. */
  private async _handleShareeOffer(viewerId: string, sdp: string): Promise<void> {
    this._closeShareePc(viewerId);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._shareePcs.set(viewerId, pc);

    // Sharer receives the data channel created by the viewer
    pc.ondatachannel = ({ channel }) => {
      channel.binaryType = "arraybuffer";
      this._shareeChannels.set(viewerId, channel);
      channel.onclose = () => this._shareeChannels.delete(viewerId);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({ type: "screenshare_ice", from: this.userId, to: viewerId, candidate: candidate.toJSON() }).catch(() => {});
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.broadcast({ type: "screenshare_answer", from: this.userId, to: viewerId, sdp: answer.sdp! });
    } catch {
      this._closeShareePc(viewerId);
    }
  }

  private _closeShareePc(viewerId: string): void {
    this._shareeChannels.get(viewerId)?.close();
    this._shareeChannels.delete(viewerId);
    this._shareePcs.get(viewerId)?.close();
    this._shareePcs.delete(viewerId);
  }

  private _closeViewerPc(sharerId: string): void {
    this._viewerPcs.get(sharerId)?.close();
    this._viewerPcs.delete(sharerId);
  }

  // ── Video WebRTC helpers ────────────────────────────────────────────────────

  /** Receiver: create PC that requests video from a remote camera sender. */
  private async _setupVideoReceiverPc(senderId: string): Promise<void> {
    this._closeVideoReceiverPc(senderId);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._videoReceiverPcs.set(senderId, pc);

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
      this._closeVideoReceiverPc(senderId);
    }
  }

  /** Sender: handle an offer from a viewer, answer with our camera track. */
  private async _handleVideoOffer(viewerId: string, sdp: string): Promise<void> {
    if (!this._cameraStream) return;
    this._closeVideoSenderPc(viewerId);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    this._videoSenderPcs.set(viewerId, pc);

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
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.broadcast({ type: "video_answer", from: this.userId, to: viewerId, sdp: answer.sdp! });
    } catch {
      this._closeVideoSenderPc(viewerId);
    }
  }

  private _closeVideoSenderPc(viewerId: string): void {
    this._videoSenderPcs.get(viewerId)?.close();
    this._videoSenderPcs.delete(viewerId);
  }

  private _closeVideoReceiverPc(senderId: string): void {
    this._videoReceiverPcs.get(senderId)?.close();
    this._videoReceiverPcs.delete(senderId);
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
        this.updateSpeaking(msg.from, msg.speaking);
        break;
      case "screenshare_start": {
        this._clearRemoteCanvas(msg.from);
        this._closeViewerPc(msg.from);
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(0);
        this._remoteCanvases.set(msg.from, { canvas, stream });
        this.cb.onScreenShareStart?.(msg.from, stream);
        // Kick off WebRTC negotiation — viewer is the offerer
        void this._setupViewerPc(msg.from);
        break;
      }
      case "screenshare_stop":
        this._closeViewerPc(msg.from);
        this._clearRemoteCanvas(msg.from);
        this.cb.onScreenShareStop?.(msg.from);
        break;
      case "screenshare_offer":
        if (msg.to !== this.userId) break;
        void this._handleShareeOffer(msg.from, msg.sdp);
        break;
      case "screenshare_answer": {
        if (msg.to !== this.userId) break;
        const pc = this._viewerPcs.get(msg.from);
        if (pc) await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        break;
      }
      case "screenshare_ice": {
        if (msg.to !== this.userId) break;
        const pc = this._viewerPcs.get(msg.from) ?? this._shareePcs.get(msg.from);
        if (pc) await pc.addIceCandidate(msg.candidate);
        break;
      }
      case "video_start":
        this._closeVideoReceiverPc(msg.from);
        void this._setupVideoReceiverPc(msg.from);
        break;
      case "video_stop":
        this._closeVideoReceiverPc(msg.from);
        this.cb.onVideoStop?.(msg.from);
        break;
      case "video_offer":
        if (msg.to !== this.userId) break;
        void this._handleVideoOffer(msg.from, msg.sdp);
        break;
      case "video_answer": {
        if (msg.to !== this.userId) break;
        const vpc = this._videoReceiverPcs.get(msg.from);
        if (vpc) await vpc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        break;
      }
      case "video_ice": {
        if (msg.to !== this.userId) break;
        const vpc = this._videoReceiverPcs.get(msg.from) ?? this._videoSenderPcs.get(msg.from);
        if (vpc) await vpc.addIceCandidate(msg.candidate);
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
