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

/** Stop a sound (e.g. ringtone loop). */
export function stopSound(name: SoundName) {
  const audio = audioCache.get(name);
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
