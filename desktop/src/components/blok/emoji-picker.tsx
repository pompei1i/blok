import { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const emojiCategories = [
  {
    name: "Smileys",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😅",
      "😂",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "😉",
      "😌",
      "😍",
      "🥰",
      "😘",
      "😗",
      "😙",
      "😚",
      "😋",
      "😛",
      "😜",
      "🤪",
      "😝",
      "🤑",
      "🤗",
      "🤭",
      "🤫",
      "🤔",
      "🤐",
      "🤨",
      "😐",
      "😑",
      "😶",
      "😏",
      "😒",
      "🙄",
      "😬",
      "😮‍💨",
      "🤥",
    ],
  },
  {
    name: "Gestures",
    emojis: [
      "👍",
      "👎",
      "👊",
      "✊",
      "🤛",
      "🤜",
      "👏",
      "🙌",
      "👐",
      "🤲",
      "🤝",
      "🙏",
      "✍️",
      "💪",
      "🦾",
      "🖕",
      "👋",
      "🤙",
      "👆",
      "👇",
      "👉",
      "👈",
      "✌️",
      "🤞",
      "🤟",
      "🤘",
      "🤏",
      "👌",
      "🤌",
      "👈",
    ],
  },
  {
    name: "Hearts",
    emojis: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "🤎",
      "💔",
      "❣️",
      "💕",
      "💞",
      "💓",
      "💗",
      "💖",
      "💘",
      "💝",
      "💟",
      "♥️",
    ],
  },
  {
    name: "Objects",
    emojis: [
      "💻",
      "🖥️",
      "⌨️",
      "🖱️",
      "🖲️",
      "💾",
      "💿",
      "📀",
      "📱",
      "📲",
      "☎️",
      "📞",
      "📟",
      "📠",
      "🔋",
      "🔌",
      "💡",
      "🔦",
      "🕯️",
      "🧯",
      "🛢️",
      "💸",
      "💵",
      "💴",
      "💶",
      "💷",
      "💰",
      "💳",
      "💎",
      "⚖️",
    ],
  },
  {
    name: "Symbols",
    emojis: [
      "✅",
      "❌",
      "❓",
      "❗",
      "💯",
      "🔥",
      "✨",
      "⭐",
      "🌟",
      "💫",
      "💥",
      "💢",
      "💦",
      "💨",
      "🕳️",
      "💣",
      "💬",
      "👁️‍🗨️",
      "🗨️",
      "🗯️",
      "💭",
      "💤",
      "🔔",
      "🔕",
      "🎵",
      "🎶",
      "🔴",
      "🟠",
      "🟡",
      "🟢",
      "🔵",
      "🟣",
      "⚫",
      "⚪",
    ],
  },
];

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEmojis = searchQuery
    ? emojiCategories.flatMap((c) => c.emojis)
    : emojiCategories[activeCategory].emojis;

  return (
    <div className="absolute bottom-full right-0 mb-2 w-64 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden animate-slide-in z-50">
      <div className="p-1.5 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder={t("emoji.searchEmojis")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
        />
      </div>

      {!searchQuery && (
        <div className="flex border-b border-[var(--border)]">
          {emojiCategories.map((category, idx) => (
            <button
              key={category.name}
              onClick={() => setActiveCategory(idx)}
              className={cn(
                "flex-1 px-1 py-1.5 text-xs transition-colors",
                activeCategory === idx
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
              )}
              title={category.name}
            >
              {category.emojis[0]}
            </button>
          ))}
        </div>
      )}

      <div className="p-1.5 h-36 overflow-y-auto">
        <div className="grid grid-cols-7 gap-0.5">
          {filteredEmojis.map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              onClick={() => {
                onSelect(emoji);
                onClose();
              }}
              className="w-7 h-7 flex items-center justify-center text-base hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

