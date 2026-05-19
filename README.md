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
| Локализация | 6 языков, 140+ ключей (JSON) | 6 языков, 140+ ключей (JSON) |

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
- Приглашение пользователей на сервер по username

### Текстовый чат
- Отправка и получение сообщений в реальном времени (Supabase Realtime)
- Вложения: изображения, видео, аудио, документы (Base64 data URLs) + drag-and-drop
- GIF-пикер (Tenor API), emoji-пикер, mention picker (`@username`)
- Ответы на сообщения (reply system) с quote-preview
- Закреплённые сообщения (pin bar, jump-to)
- Emoji-реакции: realtime + DB
- Markdown-подобное форматирование + XSS-защита (DOMPurify)

### Голосовые каналы
- **Десктоп**: native audio engine на базе cpal (Rust) через Tauri IPC
- **Браузер**: WebRTC (getUserMedia + RTCPeerConnection + Supabase Realtime signaling)
- Mute / deafen с отображением иконок у каждого участника
- Speaking-индикатор в реальном времени
- Presence-трекинг через Supabase Realtime
- Настройки: noise suppression, echo cancellation, input volume, push-to-talk
- Демонстрация экрана (десктоп: native picker; браузер: getDisplayMedia)

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
| View: compact mode, member list toggle, UI scale | CSS-переменные |
| Theme: dark / light / darker, Custom CSS | CSS-переменные + live inject |
| Language | 6 языков (EN/RU/UA/PL/DE/ES) |

### Безопасность
- RLS политики на всех таблицах Supabase
- XSS-защита: HTML-экранирование + DOMPurify allowlist
- CSP в tauri.conf.json (без `unsafe-inline`/`unsafe-eval`)

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
| `user_presence` | Статусы присутствия |

RLS схема — `supabase/policies.sql`. Для Realtime:
```sql
ALTER TABLE user_relationships REPLICA IDENTITY FULL;
ALTER TABLE user_presence REPLICA IDENTITY FULL;
```

## Релизы

Релизы десктопного приложения публикуются автоматически через GitHub Actions при push тега `v*`. Воркфлоу собирает NSIS-установщик и публикует GitHub Release с автоапдейтером (Tauri updater).
