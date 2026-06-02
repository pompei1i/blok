# $blok

Мессенджер в стиле Discord/Slack — **нативный десктоп** (Tauri 2) + **веб-приложение** (Next.js 15).

## Стек

| Слой | Десктоп (`desktop/`) | Веб (`/`) |
|---|---|---|
| UI | React 19, Tailwind CSS 4, Lucide | React 19, Tailwind CSS 4, Lucide |
| Язык | TypeScript strict | TypeScript strict |
| Сборка | Vite 7 | Next.js 15 (Turbopack) |
| Состояние | Zustand 4 | Zustand 4 |
| Бэкенд | Supabase (Auth, Realtime, PostgreSQL) | Supabase (Auth, Realtime, PostgreSQL) |
| Desktop | Tauri 2 (NSIS-установщик, Windows) | — |
| Голос | cpal (Rust, native audio engine) | WebRTC (getUserMedia + RTCPeerConnection) |
| Локализация | 6 языков, 165+ ключей (JSON) | 6 языков, 165+ ключей (JSON) |

## Архитектура

```
blok/
├── app/                     # Next.js App Router (браузер)
│   ├── layout.tsx
│   └── page.tsx
├── components/blok/         # React-компоненты (браузер)
├── lib/
│   ├── store/               # Zustand-сторы (auth, group, friends, dm, ui-settings)
│   ├── voice-engine.ts      # WebRTC голос (браузер)
│   ├── supabaseClient.ts    # Supabase клиент (NEXT_PUBLIC_*)
│   └── utils.ts
├── hooks/                   # use-mobile и др.
├── styles/                  # Tailwind + терминальная тема
└── desktop/                 # Tauri 2 десктоп-приложение
    ├── src/
    │   ├── components/blok/
    │   ├── lib/
    │   │   ├── native-voice-engine.ts   # cpal (Rust ↔ TS IPC)
    │   │   ├── voice-engine.ts          # WebRTC fallback
    │   │   └── store/
    │   └── App.tsx
    └── src-tauri/           # Rust backend (audio, tray, updater)
```

## Что реализовано

### Аутентификация и профиль
- Регистрация и вход через Supabase Auth
- Редактирование профиля: display name, username, email, статус, bio, pronouns, акцент-цвет
- Presence: автоматически `online` при входе, `offline` при выходе

### Серверы и каналы
- Загрузка серверов, каналов, категорий и участников из Supabase
- Создание сервера, текстовых и голосовых каналов
- Приглашение пользователей по username или по invite-коду (8 символов, генерируется владельцем)
- Удаление канала с диалогом подтверждения

### Текстовый чат
- Отправка и получение сообщений в реальном времени (Supabase Realtime)
- Вложения: изображения, видео, аудио, документы (Supabase Storage, до 10 МБ) + drag-and-drop
- GIF-пикер (Tenor API), emoji-пикер, mention picker (`@username`)
- Ответы на сообщения (reply system) с quote-preview
- Редактирование и удаление сообщений
- Закреплённые сообщения (pin bar, jump-to)
- Emoji-реакции: realtime + DB
- Пагинация истории: подгрузка по 30 сообщений при скролле к началу, позиция сохраняется
- Markdown-подобное форматирование + XSS-защита (DOMPurify)
- Оффлайн-баннер при потере соединения
- **Поиск по каналу** (`Ctrl+F` / 🔍): модальное окно, ILIKE-запрос, ↑↓ навигация, прыжок к сообщению
- **Опросы**: один/несколько вариантов, анонимный/открытый, подтверждение голоса, realtime-счётчики, прогресс-бары
- Контекстное меню по ПКМ, портальный рендер (не обрезается и не закрывается при движении мыши)

### Голосовые каналы
- **Десктоп**: native audio engine на базе cpal (Rust) через Tauri IPC
- **Браузер**: WebRTC (getUserMedia + RTCPeerConnection + Supabase Realtime signaling)
- Mute / deafen с отображением иконок у каждого участника
- Speaking-индикатор в реальном времени
- Presence-трекинг через Supabase Realtime
- Настройки: noise suppression, echo cancellation, input volume, push-to-talk
- Демонстрация экрана (десктоп: native picker; браузер: getDisplayMedia)
- Настройки качества демонстрации: FPS (1–30), разрешение (720p/1080p/1440p/native), JPEG quality (Low/Medium/High)

### Presence
- Статус-точка на аватаре в чате: зелёная (online), жёлтая (afk), красная (offline/dnd)
- DB-based heartbeat каждые 30 с — статус по давности, не по lifecycle-событиям
- «Был в сети X назад» для офлайн-друзей
- Собственный пользователь всегда отображается как online

### Друзья и личные сообщения (DM)
- Система друзей: запросы, принятие/отклонение, presence-статусы
- Плавающие DM-попапы с перетаскиванием, минимизацией, счётчиком непрочитанных
- История DM с вложениями и GIF

### Настройки (7 вкладок)
| Раздел | Работает |
|---|---|
| Аудио: noise suppression / echo cancellation | getUserMedia constraints |
| Аудио: input volume (0–100%) | GainNode |
| Аудио: push-to-talk (Space) | keydown/keyup |
| Видео: camera quality | getUserMedia constraints |
| Видео: screen share FPS / resolution / quality | Rust encoder + ui-settings-store |
| View: compact mode, member list toggle, UI scale | CSS-переменные |
| Theme: dark / light / darker, Custom CSS | CSS-переменные + live inject |
| Language | 6 языков (EN/RU/UA/PL/DE/ES) |

### Безопасность
- RLS политики на всех таблицах Supabase
- XSS-защита: HTML-экранирование + DOMPurify allowlist
- CSP в tauri.conf.json (без `unsafe-inline`/`unsafe-eval`)
- Входящие screen_frame-кадры ограничены до 3840 × 2160 и 400 KB (защита от canvas DoS)
- Invite-коды генерируются через `crypto.getRandomValues` (CSPRNG, 40 бит)

## Запуск

### Браузерное веб-приложение

```bash
# из корня d:\blok
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm start          # production server
```

Переменные окружения (`.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### Десктопное приложение (Tauri)

```bash
# из desktop/
npm install
npm run tauri dev    # нативное окно (dev)
npm run tauri build  # сборка .exe (NSIS)
```

Или через скрипт (устанавливает Rust автоматически):
```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Переменные окружения (`desktop/.env`):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TENOR_API_KEY=...   # опционально
```

## База данных

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
| `dm_channels` | DM-каналы |
| `dm_messages` | Сообщения в DM |
| `user_presence` | Статусы присутствия (heartbeat `online_at`) |
| `polls` | Опросы (вопрос, тип, анонимность) |
| `poll_options` | Варианты ответов |
| `poll_votes` | Голоса (`UNIQUE(poll_option_id, user_id)`) |

`servers.invite_code` — nullable VARCHAR, генерируется по запросу владельца.

RLS схема — `supabase/policies.sql`. Для Realtime:
```sql
ALTER TABLE user_relationships REPLICA IDENTITY FULL;
ALTER TABLE user_presence REPLICA IDENTITY FULL;
```

## Тесты

Десктопное приложение покрыто интеграционными тестами (Vitest + jsdom):

```bash
# из desktop/
npm run test          # однократный прогон
npm run test:watch    # watch-режим
npm run test:ui       # UI в браузере
```

Покрытие: store-экшены (`generateInviteCode`, `joinByInviteCode`, `loadMoreMessages`), DM-store, friends-store, auth-store, UI-settings-store, message search, poll-slice (loadPollsForMessages, votePoll, realtime routing), утилиты, i18n.

## Релизы

Релизы десктопного приложения публикуются автоматически через GitHub Actions при push тега `v*`. Воркфлоу собирает NSIS-установщик и публикует GitHub Release с автоапдейтером (Tauri updater).
