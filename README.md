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
| Голос | WebRTC (P2P через Supabase Broadcast) |

## Архитектура

```
src/
├── components/blok/     # 23 React-компонента
├── lib/
│   ├── store/           # Zustand-сторы (auth, server, friends, dm, ui-settings)
│   ├── voice-engine.ts  # WebRTC P2P голосовой движок
│   ├── supabaseClient.ts
│   ├── i18n.ts          # Локализация (5 языков, 130+ ключей)
│   ├── sounds.ts        # Аудио-эффекты
│   └── utils.ts
└── styles/globals.css   # Tailwind + терминальная тема
```

**Точка входа:** `src/main.tsx` → `App.tsx` → `app-layout.tsx`

**Сторы:**
- `auth-store` — сессия, профиль, логин/логаут, presence on/offline
- `server-store` — серверы, каналы, участники, сообщения, WebRTC voice-состояние
- `friends-store` — список друзей, запросы в реальном времени, presence
- `dm-store` — плавающие DM-окна, история, вложения, GIF
- `ui-settings-store` — тема, язык, scale, compact mode, custom CSS, аудио-настройки (persist в localStorage)

## Что реализовано

### Аутентификация и профиль
- Регистрация и вход через Supabase Auth
- Инициализация сессии при старте приложения
- Редактирование профиля: display name, username, email, статус, bio
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
- GIF-пикер (Tenor API) — поиск и отправка GIF прямо в чат
- Emoji-пикер с категориями и поиском
- Mention picker (`@username`)
- Lazy-loading медиа через IntersectionObserver (видео/аудио не блокируют рендер)
- Markdown-подобное форматирование (bold / italic / code / links)

### Голосовые каналы
- WebRTC P2P аудиосвязь через Supabase Broadcast (сигнализация)
- Mute / deafen / список участников в реальном времени
- Speaking-индикатор через Web Audio API (AnalyserNode)
- Presence-трекинг через Supabase Realtime Presence
- Настройки применяются при входе: noise suppression, echo cancellation, input volume

### Друзья и личные сообщения (DM)
- Система друзей: запросы, принятие/отклонение, удаление
- Realtime — заявки приходят мгновенно без обновления страницы
- Поиск по друзьям, presence-статусы
- Плавающие DM-попапы: перетаскивание за заголовок, минимизация, счётчик непрочитанных
- История DM с вложениями и GIF
- Поддержка нескольких открытых DM одновременно

### Настройки
| Раздел | Работает |
|---|---|
| Аудио: noise suppression / echo cancellation | применяется к `getUserMedia` |
| Аудио: input volume (0–100%) | GainNode, меняется live |
| Аудио: push-to-talk (Space) | глобальный keydown/keyup |
| View: compact mode | CSS-правила по `data-compact-mode` |
| View: member list toggle | показывает/скрывает FriendsSidebar |
| View: UI scale | `fontSize` на `<html>` |
| Theme: dark / light | CSS-переменные |
| Theme: Custom CSS | инжектируется в `<style>` тег live |
| Language | 5 языков (EN/PL/DE/ES/UA) |

### UI/UX
- Терминальный визуальный стиль: grid-фон, CSS-анимации, monospace шрифт
- Custom CSS — пользователь вставляет свой CSS, применяется мгновенно
- Compact mode — плотная верстка без перезагрузки
- Звуки при входе/выходе из голосового канала

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
| `server_members` | Участники серверов с ролями |
| `messages` | Сообщения в каналах |
| `attachments` | Вложения к сообщениям |
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

### RLS политики (обязательно)

```sql
ALTER TABLE user_relationships REPLICA IDENTITY FULL;
ALTER TABLE user_presence REPLICA IDENTITY FULL;
```

Таблицы `user_relationships` и `user_presence` должны быть добавлены в Supabase Replication publication.

## Ограничения текущей версии

- **Вложения** — хранятся как Base64 в БД, без Supabase Storage. Крупные файлы могут превышать лимиты.
- **Редактирование/удаление сообщений** — кнопки есть, логика не реализована.
- **Аватар профиля** — поле есть в БД, UI загрузки не реализован.
- **Авто-обновления** — Tauri Updater не настроен, обновления распространяются вручную.
- **Пагинация сообщений** — история ограничена последними 50 сообщениями.
