# $blok Desktop

Desktop-клиент мессенджера в стиле Discord/Slack на базе `React + Vite + Zustand + Supabase`, упакованный как нативное приложение через Tauri 2.

## Стек технологий

| Слой | Технология |
|---|---|
| UI | React 19, Tailwind CSS 4, Lucide React |
| Язык | TypeScript (strict mode, ES2020) |
| Сборка | Vite 7 (порт 1420 для дева) |
| Состояние | Zustand 4 (5 сторов) |
| Бэкенд | Supabase (Auth, Realtime, PostgreSQL) |
| Desktop | Tauri 2 (NSIS-установщик для Windows) |
| GIF | Tenor API v1 |
| Голос | cpal (native audio engine, Rust) |

## Архитектура

```
src/
├── components/blok/     # React-компоненты
├── hooks/               # Кастомные хуки (useChatInput, ...)
├── lib/
│   ├── store/           # Zustand-сторы (auth, server, friends, dm, ui-settings)
│   ├── constants.ts     # Именованные константы (пороги, размеры, таймауты)
│   ├── native-voice-engine.ts  # cpal-обёртка (Rust ↔ TS IPC)
│   ├── supabaseClient.ts
│   ├── i18n.ts          # Локализация (5 языков, 130+ ключей)
│   ├── sounds.ts        # Аудио-эффекты
│   └── utils.ts
└── styles/globals.css   # Tailwind + терминальная тема
```

**Точка входа:** `src/main.tsx` → `App.tsx` → `app-layout.tsx`

**Сторы:**
- `auth-store` — сессия, профиль, логин/логаут, presence on/offline
- `server-store` — серверы, каналы, участники, сообщения, голосовое состояние
- `friends-store` — список друзей, запросы в реальном времени, presence
- `dm-store` — плавающие DM-окна, история, вложения, GIF
- `ui-settings-store` — тема, язык, scale, compact mode, custom CSS, аудио-настройки (persist в localStorage)

## Что реализовано

### Аутентификация и профиль
- Регистрация и вход через Supabase Auth
- Инициализация сессии при старте приложения
- Редактирование профиля: display name, username, email, статус, bio, pronouns
- Автонормализация username (lowercase, спецсимволы → `_`, макс. 24 символа)
- Presence: автоматически `online` при входе, `offline` при выходе или закрытии окна

### Серверы и каналы
- Загрузка серверов, каналов, категорий и участников из Supabase (параллельные запросы)
- Создание сервера с автоматическим каналом `general`
- Создание текстовых и голосовых каналов
- Приглашение пользователей на сервер по username (только владелец)
- Ленивая загрузка истории сообщений при переключении канала

### Текстовый чат
- Отправка и получение сообщений в реальном времени (Supabase Realtime)
- История сообщений с вложениями (загружается из `attachments` join)
- Вложения: изображения, видео, аудио, документы (Base64 data URLs)
- Прогресс загрузки вложений: реальный прогресс FileReader + спиннер на кнопке отправки
- GIF-пикер (Tenor API) — поиск и отправка GIF прямо в чат
- Emoji-пикер с категориями и поиском
- Mention picker (`@username`)
- Ответы на сообщения (reply system) с quote-preview
- Закреплённые сообщения (pin bar, jump-to)
- Lazy-loading медиа через IntersectionObserver
- Markdown-подобное форматирование (bold / italic / code / links) с XSS-защитой (DOMPurify)
- Emoji-реакции: быстрый пикер при ховере, пилюли под сообщением, realtime + DB

### Голосовые каналы
- Native audio engine на базе cpal (Rust) через Tauri IPC
- Mute / deafen с отображением иконок статуса у каждого участника:
  - `MicOff` — микрофон выключен или включён деафен
  - `VolumeX` — деафен (не слышит других)
  - `Monitor` — демонстрация экрана (кликабельна: открывает оверлей просмотра)
- Speaking-индикатор в реальном времени (ring вокруг аватара)
- Presence-трекинг через Supabase Realtime Presence (isMuted, isDeafened, isScreenSharing)
- Настройки: noise suppression, echo cancellation, input volume, push-to-talk (Space)
- Демонстрация экрана с оверлеем просмотра (ScreenShareOverlay)

### Друзья и личные сообщения (DM)
- Система друзей: запросы, принятие/отклонение, удаление
- Realtime — заявки приходят мгновенно без обновления страницы
- Поиск по друзьям, presence-статусы
- Плавающие DM-попапы: перетаскивание за заголовок, минимизация, счётчик непрочитанных
- История DM с вложениями и GIF
- Поддержка нескольких открытых DM одновременно

### Безопасность
- RLS политики на всех таблицах: `messages`, `dm_messages`, `profiles`, `user_relationships`, `dm_channels`, `channels`, `attachments`, `message_reactions`, `user_presence`
- `author_id` guard на стороне клиента для delete-операций (defense-in-depth)
- Content Security Policy: `script-src 'self'`, без `unsafe-inline`/`unsafe-eval`
- XSS-защита: HTML-экранирование → markdown-замены → DOMPurify allowlist

### Настройки
| Раздел | Работает |
|---|---|
| Аудио: noise suppression / echo cancellation | применяется к `getUserMedia` |
| Аудио: input volume (0–100%) | GainNode, меняется live |
| Аудио: push-to-talk (Space) | глобальный keydown/keyup |
| View: compact mode | CSS-правила по `data-compact-mode` |
| View: member list toggle | показывает/скрывает FriendsSidebar |
| View: UI scale | `fontSize` на `<html>` |
| Theme: dark / light / darker | CSS-переменные |
| Theme: Custom CSS | инжектируется в `<style>` тег live |
| Language | 5 языков (EN/RU/PL/DE/ES/UA) |

### UI/UX
- Терминальный визуальный стиль: grid-фон, CSS-анимации, monospace шрифт
- Custom CSS — пользователь вставляет свой CSS, применяется мгновенно
- Compact mode — плотная верстка без перезагрузки
- Звуки при входе/выходе из голосового канала
- Push-уведомления на новые сообщения (browser Notification API)
- Unread-счётчики: бейджи на каналах и серверных табах
- Системный трей: минимизация вместо закрытия
- Авто-обновление через GitHub Releases (Tauri updater)

## Запуск

```bash
npm install
npm run dev          # dev-сервер (http://localhost:1420)
npm run tauri dev    # Tauri desktop (нативное окно)
npm run tauri build  # сборка .exe установщика (NSIS)
```

Или через скрипт (автоматически установит Rust если не установлен):

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

## База данных

Схема управляется напрямую в Supabase-консоли. Основные таблицы:

| Таблица | Назначение |
|---|---|
| `profiles` | Профили пользователей |
| `servers` | Серверы |
| `channels` | Каналы (text / voice) |
| `categories` | Категории каналов |
| `server_members` | Участники серверов |
| `messages` | Сообщения в каналах |
| `attachments` | Вложения к сообщениям |
| `message_reactions` | Emoji-реакции |
| `user_relationships` | Друзья / запросы |
| `dm_channels` | DM-каналы (user_a_id + user_b_id) |
| `dm_messages` | Сообщения в DM |
| `user_presence` | Статусы присутствия |

Конфигурация Supabase — в `.env` (не коммитится):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TENOR_API_KEY=...   # опционально, по умолчанию demo-ключ
```

### RLS (обязательно)

Все таблицы защищены Row Level Security. Политики зафиксированы в `supabase/policies.sql`.

Дополнительно для Realtime:
```sql
ALTER TABLE user_relationships REPLICA IDENTITY FULL;
ALTER TABLE user_presence REPLICA IDENTITY FULL;
```

Таблицы `user_relationships` и `user_presence` должны быть добавлены в Supabase Replication publication.

## Ограничения текущей версии

- **Вложения** — хранятся как Base64 в БД, без Supabase Storage. Крупные файлы (>3MB) могут замедлять отправку.
- **Редактирование сообщений** — не реализовано.
- **Пагинация сообщений** — история ограничена последними 50 сообщениями.
