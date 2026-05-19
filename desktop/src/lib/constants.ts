// ── Chat / messages ───────────────────────────────────────────────────────────

/** Messages from the same author within this window are visually grouped. */
export const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

/** How long the highlight-flash animation runs after jumping to a message. */
export const HIGHLIGHT_FLASH_DURATION_MS = 1_500;

/** Max characters shown for a reply preview in server channels. */
export const REPLY_PREVIEW_MAX_CHARS = 80;

/** Max characters shown for a reply preview in DM bubbles. */
export const REPLY_PREVIEW_MAX_CHARS_DM = 60;

/** Number of channel messages loaded per page. */
export const MESSAGE_PAGE_SIZE = 30;

/** Number of DM messages loaded per page. */
export const DM_PAGE_SIZE = 30;

/** Max characters shown in a desktop notification preview. */
export const NOTIFICATION_PREVIEW_LEN = 80;

/** Max number of channels kept in the LRU message cache simultaneously. */
export const MESSAGE_LRU_LIMIT = 5;

// ── DM popups ─────────────────────────────────────────────────────────────────

/** Pixel cascade offset between stacked DM popup windows. */
export const DM_WINDOW_OFFSET_PX = 30;

/** Default DM popup width in rem. */
export const DM_WINDOW_W_REM = 21.25;

/** Default DM popup height in rem. */
export const DM_WINDOW_H_REM = 26.25;

/** Viewport edge padding when computing default popup position (px). */
export const DM_VIEWPORT_PADDING_PX = 80;

/** Fallback popup X position when window is not available (px). */
export const DM_FALLBACK_X = 400;

/** Fallback popup Y position when window is not available (px). */
export const DM_FALLBACK_Y = 200;

/** Timeout (ms) before an unanswered call invite is auto-cancelled. */
export const CALL_INVITE_TIMEOUT_MS = 45_000;

// ── Audio ─────────────────────────────────────────────────────────────────────

/** Default noise-gate threshold (0-100 scale used by the native audio engine). */
export const NOISE_GATE_DEFAULT = 30;

// ── Updater ───────────────────────────────────────────────────────────────────

/** Delay (ms) after app load before the auto-updater check fires. */
export const UPDATER_CHECK_DELAY_MS = 3_000;

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
