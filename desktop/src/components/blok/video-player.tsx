import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  src: string;
  className?: string;
  poster?: string;
}

export function VideoPlayer({ src, className, poster }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [decodedSrc, setDecodedSrc] = useState<string | null>(
    src.startsWith("data:") ? null : src
  );

  const controlsTimeoutRef = useRef<NodeJS.Timeout>(null);

  // Decode data URI → Blob URL via fetch (non-blocking, no atob on main thread)
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
    const video = videoRef.current;
    if (!video) return;

    const setVideoData = () => setDuration(video.duration);
    const setVideoTime = () => setProgress(video.currentTime);

    video.addEventListener("loadeddata", setVideoData);
    video.addEventListener("timeupdate", setVideoTime);
    video.addEventListener("ended", () => setIsPlaying(false));
    video.addEventListener("play", () => setIsPlaying(true));
    video.addEventListener("pause", () => setIsPlaying(false));

    return () => {
      video.removeEventListener("loadeddata", setVideoData);
      video.removeEventListener("timeupdate", setVideoTime);
      video.removeEventListener("ended", () => setIsPlaying(false));
      video.removeEventListener("play", () => setIsPlaying(true));
      video.removeEventListener("pause", () => setIsPlaying(false));
    };
  }, [decodedSrc]);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
    }
  };

  const handleMouseLeave = () => {
    if (isPlaying) setShowControls(false);
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setProgress(time);
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
      ref={containerRef}
      className={cn(
        "relative group overflow-hidden rounded-lg bg-black border border-[var(--border)] max-w-sm max-h-80 w-full flex items-center justify-center",
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={togglePlay}
    >
      {decodedSrc ? (
        <video
          ref={videoRef}
          src={decodedSrc}
          poster={poster}
          className="w-full h-full object-contain"
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="w-full h-32 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--accent-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {decodedSrc && !isPlaying && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-red)]/90 flex items-center justify-center text-white backdrop-blur-sm">
            <Play className="w-6 h-6 fill-current ml-1" />
          </div>
        </div>
      )}

      {/* Controls Overlay */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-3 px-4 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} className="text-white hover:text-[var(--accent-red)] transition-colors">
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
          </button>
          
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[12px] text-white/80 font-mono w-8">{formatTime(progress)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={progress}
              onChange={handleProgressChange}
              className="flex-1 h-1 bg-white/30 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-[var(--accent-red)] [&::-webkit-slider-thumb]:rounded-full cursor-pointer focus:outline-none"
              style={{
                background: `linear-gradient(to right, var(--accent-red) ${(progress / duration) * 100}%, rgba(255,255,255,0.3) ${(progress / duration) * 100}%)`
              }}
            />
            <span className="text-[12px] text-white/80 font-mono w-8">{formatTime(duration)}</span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleMute} className="text-white hover:text-white/80 transition-colors">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button onClick={toggleFullscreen} className="text-white hover:text-white/80 transition-colors">
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
