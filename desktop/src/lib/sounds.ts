/**
 * Sound effects manager for Blok
 *
 * Usage:
 *   import { playSound } from "@/lib/sounds";
 *   playSound("join");
 */

const SOUND_FILES = {
  join: "/sounds/join.mp3",
  leave: "/sounds/leave.mp3",
  ringtone: "/sounds/ringtone.mp3",
} as const;

export type SoundName = keyof typeof SOUND_FILES;

const VOLUME = 0.4;

// One Audio element per sound — reused to prevent overlapping
const audioCache = new Map<SoundName, HTMLAudioElement>();

function getAudio(name: SoundName): HTMLAudioElement {
  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(SOUND_FILES[name]);
    audio.volume = VOLUME;
    audioCache.set(name, audio);
  }
  return audio;
}

/** Play a sound effect. Stops any previous instance of the same sound first. */
export function playSound(name: SoundName, loop = false): HTMLAudioElement | null {
  try {
    const audio = getAudio(name);

    // Stop current playback so sounds never layer on top of each other
    audio.pause();
    audio.currentTime = 0;
    audio.loop = loop;
    audio.volume = VOLUME;

    audio.play().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`Failed to play sound "${name}":`, err);
    });

    return audio;
  } catch {
    return null;
  }
}

/** Short synthesized beep for incoming message notifications. */
export function playNotificationBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx() as AudioContext;
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

/** Stop a sound (e.g. ringtone loop). */
export function stopSound(name: SoundName) {
  const audio = audioCache.get(name);
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

// ── Synthesized UI sounds ─────────────────────────────────────────────────────

function _getAudioCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch { return null; }
}

function _synthTones(freqs: number[], duration: number, gapSec: number, volume = 0.18): void {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    const t = ctx.currentTime + i * gapSec;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration);
  });
  setTimeout(() => ctx.close(), (freqs.length * gapSec + duration) * 1000 + 200);
}

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

function _ringBurst(): void {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  [0, 0.5].forEach((offset) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(480, ctx.currentTime + offset);
    gain.gain.setValueAtTime(0, ctx.currentTime + offset);
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + offset + 0.02);
    gain.gain.setValueAtTime(0.28, ctx.currentTime + offset + 0.32);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + offset + 0.4);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.4);
  });
  setTimeout(() => ctx.close(), 1600);
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

/** Exposed for unit tests only — clears the internal audio element cache. */
export function _clearSoundCacheForTesting(): void {
  audioCache.clear();
}
