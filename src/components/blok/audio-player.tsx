import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, FileAudio } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  filename?: string;
  className?: string;
}

export function AudioPlayer({ src, filename, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [decodedSrc, setDecodedSrc] = useState<string | null>(
    src.startsWith("data:") ? null : src
  );

  // Decode data URI → Blob URL via fetch (non-blocking)
  useEffect(() => {
    if (!src.startsWith("data:")) {
      setDecodedSrc(src);
      return;
    }
    let blobUrl: string | null = null;
    let cancelled = false;
    fetch(src)
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setDecodedSrc(blobUrl);
      })
      .catch(() => { if (!cancelled) setDecodedSrc(src); });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setAudioData = () => setDuration(audio.duration);
    const setAudioTime = () => setProgress(audio.currentTime);

    audio.addEventListener("loadeddata", setAudioData);
    audio.addEventListener("timeupdate", setAudioTime);
    audio.addEventListener("ended", () => setIsPlaying(false));

    return () => {
      audio.removeEventListener("loadeddata", setAudioData);
      audio.removeEventListener("timeupdate", setAudioTime);
      audio.removeEventListener("ended", () => setIsPlaying(false));
    };
  }, [decodedSrc]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl w-full max-w-sm",
        className
      )}
    >
      {decodedSrc && <audio ref={audioRef} src={decodedSrc} preload="metadata" />}
      
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-[var(--accent-red)] flex items-center justify-center text-white hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-1" />
          )}
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileAudio className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
              <span className="text-[var(--text-primary)] font-medium truncate">
                {filename || "Audio Attachment"}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             <span className="text-[10px] text-[var(--text-muted)] font-mono w-8 text-right">
                {formatTime(progress)}
              </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={progress}
              onChange={handleProgressChange}
              className="flex-1 h-1.5 bg-[var(--bg-hover)] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[var(--accent-red)] [&::-webkit-slider-thumb]:rounded-full cursor-pointer focus:outline-none"
              style={{
                background: `linear-gradient(to right, var(--accent-red) ${(progress / duration) * 100}%, var(--bg-hover) ${(progress / duration) * 100}%)`
              }}
            />
            <span className="text-[10px] text-[var(--text-muted)] font-mono w-8">
                {formatTime(duration)}
              </span>
          </div>
        </div>

        <button
          onClick={toggleMute}
          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors ml-1"
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
