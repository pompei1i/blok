'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const emojiCategories = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥'],
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🖕', '👋', '🤙', '👆', '👇', '👉', '👈', '✌️', '🤞', '🤟', '🤘', '🤏', '👌', '🤌', '👈'],
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
  },
  {
    name: 'Objects',
    emojis: ['💻', '🖥️', '⌨️', '🖱️', '🖲️', '💾', '💿', '📀', '📱', '📲', '☎️', '📞', '📟', '📠', '🔋', '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️'],
  },
  {
    name: 'Symbols',
    emojis: ['✅', '❌', '❓', '❗', '💯', '🔥', '✨', '⭐', '🌟', '💫', '💥', '💢', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤', '🔔', '🔕', '🎵', '🎶', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪'],
  },
];

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEmojis = searchQuery
    ? emojiCategories.flatMap(c => c.emojis).filter(() => true) // In real app, filter by emoji name
    : emojiCategories[activeCategory].emojis;

  return (
    <div className="absolute bottom-full right-0 mb-2 w-80 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden animate-slide-in">
      {/* Search */}
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder={t("emoji.searchEmojis")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
        />
      </div>

      {/* Category tabs */}
      {!searchQuery && (
        <div className="flex border-b border-[var(--border)]">
          {emojiCategories.map((category, idx) => (
            <button
              key={category.name}
              onClick={() => setActiveCategory(idx)}
              className={cn(
                'flex-1 px-2 py-2 text-xs transition-colors',
                activeCategory === idx
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              )}
              title={category.name}
            >
              {category.emojis[0]}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="p-2 h-48 overflow-y-auto">
        <div className="grid grid-cols-8 gap-1">
          {filteredEmojis.map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              onClick={() => {
                onSelect(emoji);
                onClose();
              }}
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
