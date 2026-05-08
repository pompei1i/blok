import { supabase } from "./supabaseClient";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const SPEAKING_THRESHOLD = 15;
const SPEAKING_POLL_MS = 100;

type SignalMsg =
  | { type: "join"; from: string }
  | { type: "leave"; from: string }
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

export interface VoiceCallbacks {
  onParticipantJoin: (userId: string) => void;
  onParticipantLeave: (userId: string) => void;
  onSpeakingChange: (userId: string, speaking: boolean) => void;
}

export interface VoiceAudioSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  inputVolume: number; // 0–100
}

export class VoiceEngine {
  private channelId: string;
  private userId: string;
  private cb: VoiceCallbacks;
  private audioSettings: VoiceAudioSettings;

  private realtimeCh: ReturnType<typeof supabase.channel> | null = null;
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  private peers = new Map<string, RTCPeerConnection>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private audioElements = new Map<string, HTMLAudioElement>();
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
      noiseSuppression: audioSettings?.noiseSuppression ?? true,
      echoCancellation: audioSettings?.echoCancellation ?? true,
      inputVolume: audioSettings?.inputVolume ?? 100,
    };
    this.subscribePromise = new Promise((res) => {
      this._subscribeResolve = res;
    });
  }

  async join(): Promise<void> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.audioSettings.echoCancellation,
        noiseSuppression: this.audioSettings.noiseSuppression,
        autoGainControl: true,
      },
      video: false,
    });

    this.audioCtx = new AudioContext();
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // Apply input volume via GainNode
    const source = this.audioCtx.createMediaStreamSource(this.localStream);
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.audioSettings.inputVolume / 100;
    const dest = this.audioCtx.createMediaStreamDestination();
    source.connect(this.gainNode);
    this.gainNode.connect(dest);
    // Replace raw stream with gain-processed stream for WebRTC
    this.localStream = dest.stream;

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
    for (const el of this.audioElements.values()) {
      el.muted = deafened;
    }
  }

  setInputVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = volume / 100;
    }
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
    }
  }

  private async createOffer(targetId: string): Promise<void> {
    const pc = this.getOrCreatePeer(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.broadcast({ type: "offer", from: this.userId, to: targetId, sdp: offer });
  }

  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.getOrCreatePeer(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushPending(fromId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.broadcast({ type: "answer", from: this.userId, to: fromId, sdp: answer });
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

    pc.ontrack = ({ streams }) => {
      if (streams[0]) this.attachRemoteAudio(peerId, streams[0]);
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

    const el = this.audioElements.get(peerId);
    if (el) {
      el.srcObject = null;
      this.audioElements.delete(peerId);
    }

    const t = this.speakingTimers.get(peerId);
    if (t) {
      clearInterval(t);
      this.speakingTimers.delete(peerId);
    }
    this.speakingState.delete(peerId);
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    let el = this.audioElements.get(peerId);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      this.audioElements.set(peerId, el);
    }
    el.srcObject = stream;
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
      // AudioContext unavailable in this environment
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
