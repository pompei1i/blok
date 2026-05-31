import { supabase } from "./supabaseClient";

const ICE_SERVERS: RTCIceServer[] = [
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
];

const SPEAKING_THRESHOLD = 15;
const SPEAKING_POLL_MS = 100;

type SignalMsg =
  | { type: "join"; from: string }
  | { type: "leave"; from: string }
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "screen-start"; from: string }
  | { type: "screen-stop"; from: string };

export interface VoiceCallbacks {
  onParticipantJoin: (userId: string) => void;
  onParticipantLeave: (userId: string) => void;
  onSpeakingChange: (userId: string, speaking: boolean) => void;
  onScreenShareStart?: (userId: string, stream: MediaStream) => void;
  onScreenShareStop?: (userId: string) => void;
  onVideoStart?: (userId: string, stream: MediaStream) => void;
  onVideoStop?: (userId: string) => void;
}

export interface VoiceAudioSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  inputVolume: number; // 0–100
  noiseGateThreshold: number; // 0–100 (0 = off, higher = more aggressive)
}

export class VoiceEngine {
  private channelId: string;
  private userId: string;
  private cb: VoiceCallbacks;
  private audioSettings: VoiceAudioSettings;

  private realtimeCh: ReturnType<typeof supabase.channel> | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private noiseGateNode: AudioWorkletNode | null = null;
  private outputCtx: AudioContext | null = null;
  private outputMasterGain: GainNode | null = null;
  private remoteSourceNodes = new Map<string, MediaStreamAudioSourceNode>();

  private peers = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private speakingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private speakingState = new Map<string, boolean>();

  private _subscribed = false;
  private _subscribeResolve: (() => void) | null = null;
  private subscribePromise: Promise<void>;

  constructor(channelId: string, userId: string, cb: VoiceCallbacks, audioSettings?: Partial<VoiceAudioSettings>) {
    this.channelId = channelId;
    this.userId = userId;
    this.cb = cb;
    this.audioSettings = {
      noiseSuppression: audioSettings?.noiseSuppression ?? false,
      echoCancellation: audioSettings?.echoCancellation ?? false,
      inputVolume: audioSettings?.inputVolume ?? 100,
      noiseGateThreshold: audioSettings?.noiseGateThreshold ?? 30,
    };
    this.subscribePromise = new Promise((res) => {
      this._subscribeResolve = res;
    });
  }

  async join(): Promise<void> {
    // Create the output AudioContext at 48 kHz BEFORE opening the microphone.
    // Having an active 48 kHz render session helps anchor the audio engine
    // format before Chrome's getUserMedia triggers Windows communications mode.
    this.outputCtx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    this.outputMasterGain = this.outputCtx.createGain();
    this.outputMasterGain.connect(this.outputCtx.destination);
    if (this.outputCtx.state === "suspended") {
      await this.outputCtx.resume();
    }

    this.audioCtx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // Open the microphone AFTER the 48 kHz render session is live.
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.audioSettings.echoCancellation,
        noiseSuppression: this.audioSettings.noiseSuppression,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: 48000,
      },
      video: false,
    });

    if ("__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("disable_audio_ducking").catch(() => {});
      });
    }

    this.trackSpeaking(this.userId, this.localStream);

    this.realtimeCh = supabase
      .channel(`voice:${this.channelId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        this.handleSignal(payload as SignalMsg);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !this._subscribed) {
          this._subscribed = true;
          this._subscribeResolve?.();
          this.broadcast({ type: "join", from: this.userId });
        }
      });

    await this.subscribePromise;
  }

  async leave(): Promise<void> {
    if (this.screenStream) await this.stopScreenShare();
    await this.broadcast({ type: "leave", from: this.userId });

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    for (const id of [...this.peers.keys()]) {
      this.closePeer(id);
    }

    for (const t of this.speakingTimers.values()) clearInterval(t);
    this.speakingTimers.clear();
    this.speakingState.clear();

    this.audioCtx?.close();
    this.audioCtx = null;
    this.outputCtx?.close();
    this.outputCtx = null;
    this.outputMasterGain = null;
    this.remoteSourceNodes.clear();

    if (this.realtimeCh) {
      await supabase.removeChannel(this.realtimeCh);
      this.realtimeCh = null;
    }
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setDeafened(deafened: boolean): void {
    if (this.outputMasterGain) {
      this.outputMasterGain.gain.value = deafened ? 0 : 1;
    }
  }

  setInputVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = volume / 100;
    }
  }

  setNoiseGateThreshold(value: number): void {
    if (this.noiseGateNode) {
      const rmsThreshold = (value / 100) * 0.05;
      this.noiseGateNode.port.postMessage({ threshold: rmsThreshold });
    }
  }

  async startScreenShare(_sourceId?: string): Promise<void> {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 } as MediaTrackConstraints,
      audio: false,
    });

    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      this.screenStream = null;
      return;
    }

    videoTrack.onended = () => { void this.stopScreenShare(); };

    for (const pc of this.peers.values()) {
      if (pc.signalingState !== "closed") {
        pc.addTrack(videoTrack, this.screenStream);
      }
    }

    await this.broadcast({ type: "screen-start", from: this.userId });
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());

    for (const pc of this.peers.values()) {
      if (pc.signalingState !== "closed") {
        const videoSenders = pc.getSenders().filter((s) => s.track?.kind === "video");
        videoSenders.forEach((s) => { try { pc.removeTrack(s); } catch { /* ignore */ } });
      }
    }

    this.screenStream = null;
    await this.broadcast({ type: "screen-stop", from: this.userId });
  }

  isScreenSharing(): boolean {
    return this.screenStream !== null;
  }

  private async handleSignal(msg: SignalMsg): Promise<void> {
    if (msg.from === this.userId) return;

    switch (msg.type) {
      case "join":
        this.cb.onParticipantJoin(msg.from);
        await this.createOffer(msg.from);
        break;
      case "leave":
        this.closePeer(msg.from);
        this.cb.onParticipantLeave(msg.from);
        break;
      case "offer":
        if (msg.to !== this.userId) break;
        await this.handleOffer(msg.from, msg.sdp);
        this.cb.onParticipantJoin(msg.from);
        break;
      case "answer":
        if (msg.to !== this.userId) break;
        await this.handleAnswer(msg.from, msg.sdp);
        break;
      case "ice":
        if (msg.to !== this.userId) break;
        await this.handleIce(msg.from, msg.candidate);
        break;
      case "screen-start":
        // Stream arrives via ontrack; signal just prepares UI
        break;
      case "screen-stop":
        this.cb.onScreenShareStop?.(msg.from);
        break;
    }
  }

  // Force Opus fullband (48 kHz) mode.  Without this, WebRTC defaults to
  // maxplaybackrate=24000 (super-wideband) which makes voices sound like radio.
  private patchSdp(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    if (!desc.sdp) return desc;
    let sdp = desc.sdp;
    const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
    if (!opusMatch) return desc;
    const pt = opusMatch[1];
    const fmtpLine = `a=fmtp:${pt} minptime=10;useinbandfec=1;maxaveragebitrate=128000;maxplaybackrate=48000;sprop-maxcapturerate=48000;dtx=0`;
    const fmtpRegex = new RegExp(`a=fmtp:${pt} [^\r\n]+`);
    sdp = fmtpRegex.test(sdp)
      ? sdp.replace(fmtpRegex, fmtpLine)
      : sdp.replace(`a=rtpmap:${pt} opus/48000/2`, `a=rtpmap:${pt} opus/48000/2\r\n${fmtpLine}`);
    return { type: desc.type as RTCSdpType, sdp };
  }

  private async createOffer(targetId: string): Promise<void> {
    const pc = this.getOrCreatePeer(targetId);
    const offer = await pc.createOffer();
    const patched = this.patchSdp(offer);
    await pc.setLocalDescription(patched);
    await this.broadcast({ type: "offer", from: this.userId, to: targetId, sdp: patched });
  }

  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.getOrCreatePeer(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPending(fromId, pc);
    const answer = await pc.createAnswer();
    const patched = this.patchSdp(answer);
    await pc.setLocalDescription(patched);
    await this.broadcast({ type: "answer", from: this.userId, to: fromId, sdp: patched });
  }

  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPending(fromId, pc);
  }

  private async handleIce(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc?.remoteDescription) {
      const buf = this.pendingCandidates.get(fromId) ?? [];
      buf.push(candidate);
      this.pendingCandidates.set(fromId, buf);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // stale candidate
    }
  }

  private async flushPending(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const candidates = this.pendingCandidates.get(peerId) ?? [];
    this.pendingCandidates.delete(peerId);
    for (const c of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch { /* ignore */ }
    }
  }

  private getOrCreatePeer(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing && existing.signalingState !== "closed") return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(peerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // Include active screen share for late joiners
    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) pc.addTrack(videoTrack, this.screenStream);
    }

    pc.ontrack = ({ track, streams }) => {
      if (track.kind === "audio") {
        if (streams[0]) this.attachRemoteAudio(peerId, streams[0]);
      } else if (track.kind === "video") {
        if (streams[0]) {
          this.cb.onScreenShareStart?.(peerId, streams[0]);
          track.onended = () => this.cb.onScreenShareStop?.(peerId);
        }
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.broadcast({
          type: "ice",
          from: this.userId,
          to: peerId,
          candidate: candidate.toJSON(),
        });
      }
    };

    // Renegotiation when screen share track is added/removed
    pc.onnegotiationneeded = async () => {
      if (pc.signalingState === "stable" && this.peers.get(peerId) === pc) {
        try {
          await this.createOffer(peerId);
        } catch { /* ignore race conditions */ }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(peerId);
        this.cb.onParticipantLeave(peerId);
      }
    };

    return pc;
  }

  private closePeer(peerId: string): void {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.pendingCandidates.delete(peerId);

    const src = this.remoteSourceNodes.get(peerId);
    if (src) {
      try { src.disconnect(); } catch { /* ignore */ }
      this.remoteSourceNodes.delete(peerId);
    }

    const t = this.speakingTimers.get(peerId);
    if (t) {
      clearInterval(t);
      this.speakingTimers.delete(peerId);
    }
    this.speakingState.delete(peerId);
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    if (!this.outputCtx || !this.outputMasterGain) return;

    const old = this.remoteSourceNodes.get(peerId);
    if (old) { try { old.disconnect(); } catch { /* ignore */ } }

    const source = this.outputCtx.createMediaStreamSource(stream);
    source.connect(this.outputMasterGain);
    this.remoteSourceNodes.set(peerId, source);

    if (this.outputCtx.state === "suspended") {
      void this.outputCtx.resume();
    }

    this.trackSpeaking(peerId, stream);
  }

  private trackSpeaking(userId: string, stream: MediaStream): void {
    if (!this.audioCtx) return;
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const existing = this.speakingTimers.get(userId);
      if (existing) clearInterval(existing);

      const timer = setInterval(() => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        const speaking = avg > SPEAKING_THRESHOLD;
        if (speaking !== (this.speakingState.get(userId) ?? false)) {
          this.speakingState.set(userId, speaking);
          this.cb.onSpeakingChange(userId, speaking);
        }
      }, SPEAKING_POLL_MS);

      this.speakingTimers.set(userId, timer);
    } catch {
      // AudioContext unavailable
    }
  }

  private async broadcast(msg: SignalMsg): Promise<void> {
    if (!this.realtimeCh) return;
    await this.realtimeCh.send({ type: "broadcast", event: "signal", payload: msg });
  }
}

let _activeEngine: VoiceEngine | null = null;

export function getActiveVoiceEngine(): VoiceEngine | null {
  return _activeEngine;
}

export function setActiveVoiceEngine(engine: VoiceEngine | null): void {
  _activeEngine = engine;
}
