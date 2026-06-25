/**
 * Sound effects for Blok — all fully synthesized with the Web Audio API.
 *
 * There are no audio files: every cue is generated on the fly so the bundle
 * carries no binary assets and the sounds stay consistent with the app's
 * minimal, terminal aesthetic.
 *
 * Usage:
 *   import { playJoinSound } from "@/lib/sounds";
 *   playJoinSound();
 */

// ── Web Audio helpers ─────────────────────────────────────────────────────────

function _getAudioCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch { return null; }
}

/**
 * Play a sequence of tones. Each frequency starts `gapSec` after the previous
 * one and decays exponentially over `duration` seconds.
 */
function _synthTones(
  freqs: number[],
  duration: number,
  gapSec: number,
  volume = 0.18,
  type: OscillatorType = "sine",
): void {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    const t = ctx.currentTime + i * gapSec;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration);
  });
  setTimeout(() => ctx.close(), (freqs.length * gapSec + duration) * 1000 + 200);
}

// ── Notification ──────────────────────────────────────────────────────────────

/** Short synthesized beep for incoming message notifications. */
export function playNotificationBeep() {
  try {
    const ctx = _getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

// ── Voice presence cues ───────────────────────────────────────────────────────

/** Someone (or you) joined a voice channel — warm ascending two-tone. */
export function playJoinSound(): void { _synthTones([523.25, 783.99], 0.13, 0.12, 0.16, "triangle"); }

/** Someone (or you) left a voice channel — gentle descending two-tone. */
export function playLeaveSound(): void { _synthTones([659.25, 392.0], 0.14, 0.12, 0.16, "triangle"); }

/** Someone started watching your screen share — soft rising double-blip. */
export function playWatchSound(): void { _synthTones([880, 1318.51], 0.08, 0.09, 0.13, "sine"); }

// ── Mic / capture toggles ─────────────────────────────────────────────────────

/** Mic muted — two descending tones. */
export function playMuteSound(): void { _synthTones([660, 440], 0.09, 0.11); }

/** Mic unmuted — two ascending tones. */
export function playUnmuteSound(): void { _synthTones([440, 660], 0.09, 0.11); }

/** Screen share or camera turned on — quick ascending sweep. */
export function playCaptureStartSound(): void { _synthTones([550, 880], 0.07, 0.09, 0.15); }

/** Screen share or camera turned off — quick descending sweep. */
export function playCaptureStopSound(): void { _synthTones([880, 550], 0.07, 0.09, 0.15); }

// ── Ringtone (looping) ────────────────────────────────────────────────────────

let _ringtoneTimer: ReturnType<typeof setInterval> | null = null;

/** A single "bdring" — two quick rising notes, like a friendly call. */
function _ringBurst(): void {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  const notes = [
    { f: 587.33, at: 0.0 },  // D5
    { f: 880.0,  at: 0.18 }, // A5
  ];
  notes.forEach(({ f, at }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    const start = ctx.currentTime + at;
    osc.frequency.setValueAtTime(f, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.26, start + 0.02);
    gain.gain.setValueAtTime(0.26, start + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
    osc.start(start);
    osc.stop(start + 0.36);
  });
  setTimeout(() => ctx.close(), 1200);
}

/** Start looping phone ringtone (incoming / outgoing call). */
export function playRingtone(): void {
  stopRingtone();
  _ringBurst();
  _ringtoneTimer = setInterval(_ringBurst, 2200);
}

/** Stop the ringtone loop. */
export function stopRingtone(): void {
  if (_ringtoneTimer !== null) {
    clearInterval(_ringtoneTimer);
    _ringtoneTimer = null;
  }
}
