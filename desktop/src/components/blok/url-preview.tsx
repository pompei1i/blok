import { useState, useEffect } from "react";

interface OGData {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

const ogCache = new Map<string, OGData | null>();

export function UrlPreview({ url }: { url: string }) {
  const [data, setData] = useState<OGData | null | "loading">(
    ogCache.has(url) ? (ogCache.get(url) ?? null) : "loading",
  );

  useEffect(() => {
    if (ogCache.has(url)) {
      setData(ogCache.get(url) ?? null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{
        status: string;
        data: { title?: string; description?: string; image?: { url?: string }; publisher?: string };
      }>)
      .then((json) => {
        if (json.status !== "success") throw new Error("fail");
        const og: OGData = {
          title: json.data.title,
          description: json.data.description,
          imageUrl: json.data.image?.url,
          siteName: json.data.publisher,
        };
        ogCache.set(url, og);
        setData(og);
      })
      .catch(() => {
        ogCache.set(url, null);
        setData(null);
      });
    return () => ctrl.abort();
  }, [url]);

  if (data === "loading" || !data || (!data.title && !data.description)) return null;

  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex gap-3 p-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] border-l-[3px] border-l-[var(--accent-red)] rounded-lg max-w-sm hover:bg-[var(--bg-hover)] transition-colors no-underline"
      onClick={(e) => e.stopPropagation()}
      style={{ textDecoration: "none" }}
    >
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt=""
          className="w-14 h-14 rounded object-cover flex-shrink-0 bg-[var(--bg-base)]"
          loading="lazy"
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 justify-center">
        {data.siteName && (
          <span className="text-[10px] text-[var(--accent-red)] uppercase tracking-wide font-medium truncate">
            {data.siteName}
          </span>
        )}
        {data.title && (
          <span className="text-xs font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
            {data.title}
          </span>
        )}
        {data.description && (
          <span className="text-[11px] text-[var(--text-muted)] leading-snug line-clamp-2">
            {data.description}
          </span>
        )}
        <span className="text-[10px] text-[var(--text-muted)] opacity-60 truncate mt-0.5">
          {hostname}
        </span>
      </div>
    </a>
  );
}

export function extractFirstUrl(content: string): string | null {
  const m = content.match(/https?:\/\/[^\s>"')]+/);
  return m ? m[0] : null;
}
