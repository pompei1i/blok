// ── Chat / messages ───────────────────────────────────────────────────────────

/** Messages from the same author within this window are visually grouped. */
export const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

/** How long the highlight-flash animation runs after jumping to a message. */
export const HIGHLIGHT_FLASH_DURATION_MS = 1_500;

/** Max characters shown for a reply preview in server channels. */
export const REPLY_PREVIEW_MAX_CHARS = 80;

/** Max characters shown for a reply preview in DM bubbles. */
export const REPLY_PREVIEW_MAX_CHARS_DM = 60;

/** Number of DM messages loaded per page. */
export const DM_PAGE_SIZE = 30;

// ── Media / lazy loading ──────────────────────────────────────────────────────

/** IntersectionObserver rootMargin for lazy-loading images and media. */
export const LAZY_LOAD_ROOT_MARGIN = "400px";

// ── Quick emoji reactions ─────────────────────────────────────────────────────

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "✅", "🎉"] as const;

// ── Avatar ────────────────────────────────────────────────────────────────────

/** Canvas size (px) used when compressing avatars before upload. */
export const AVATAR_CANVAS_SIZE = 256;

/** JPEG quality used when compressing avatars. */
export const AVATAR_JPEG_QUALITY = 0.8;
