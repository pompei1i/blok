import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyResult {
  id: string;
  images: {
    fixed_width: GiphyImage;
    fixed_width_downsampled?: GiphyImage;
    original: GiphyImage;
  };
}

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = async (q: string) => {
    if (!GIPHY_KEY) {
      setError("Set VITE_GIPHY_API_KEY in desktop/.env");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const endpoint = q.trim()
        ? `${GIPHY_BASE}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=g`
        : `${GIPHY_BASE}/trending?api_key=${GIPHY_KEY}&limit=24&rating=g`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setGifs(data.data ?? []);
    } catch (e) {
      setError(String(e));
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGifs("");
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGifs(query), 450);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className="absolute bottom-full right-0 mb-2 w-64 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-50">
      <div className="p-1.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-2 py-1">
          <Search className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("gif.search")}
            className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>
      </div>

      <div className="h-48 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs font-mono animate-pulse">
            {t("gif.loading")}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-xs gap-1">
            <span>{t("gif.failed")}</span>
            <span className="opacity-50 font-mono">{error}</span>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs">
            {t("gif.notFound")}
          </div>
        ) : (
          <div className="columns-2 gap-1 space-y-1">
            {gifs.map((gif) => {
              const thumb = gif.images.fixed_width_downsampled?.url ?? gif.images.fixed_width.url;
              const full = gif.images.original.url;
              return (
                <img
                  key={gif.id}
                  src={thumb}
                  alt="gif"
                  loading="lazy"
                  draggable={false}
                  className="w-full rounded cursor-pointer hover:opacity-75 transition-opacity break-inside-avoid"
                  onClick={() => {
                    onSelect(full);
                    onClose();
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="px-2 py-1 border-t border-[var(--border)]">
        <span className="text-[12px] text-[var(--text-muted)]">Powered by GIPHY</span>
      </div>
    </div>
  );
}
