import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const TENOR_KEY = import.meta.env.VITE_TENOR_API_KEY as string | undefined;
const TENOR_BASE = "https://api.tenor.com/v1";

interface TenorMedia {
  gif?: { url: string };
  tinygif?: { url: string };
  nanogif?: { url: string };
}

interface TenorResult {
  id: string;
  media: TenorMedia[];
}

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = async (q: string) => {
    if (!TENOR_KEY) {
      setError("Set VITE_TENOR_API_KEY in desktop/.env");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const endpoint = q.trim()
        ? `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=24&media_filter=minimal`
        : `${TENOR_BASE}/trending?key=${TENOR_KEY}&limit=24&media_filter=minimal`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setGifs(data.results ?? []);
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
              const formats = gif.media[0];
              const thumb =
                formats?.nanogif?.url ??
                formats?.tinygif?.url ??
                formats?.gif?.url;
              const full =
                formats?.gif?.url ??
                formats?.tinygif?.url;
              if (!thumb || !full) return null;
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
        <span className="text-[10px] text-[var(--text-muted)]">Powered by Tenor</span>
      </div>
    </div>
  );
}
