# TODO (desktop)

## В работе

- [ ] Видеозвонки в voice-каналах и DM.

## Что добавить дальше

- [ ] Поиск по сообщениям, пользователям и каналам.
- [ ] Управление ролями и правами (permissions) по каналам.
- [ ] Ветки (threads) в каналах.
## Готово (v0.3.2)

- [x] E2E в CI: `.github/workflows/e2e.yml`, `windows-latest`, `tauri build --no-bundle`, `msedgedriver` из `$EDGEWEBDRIVER`, кеш `tauri-driver`.
- [x] `permission.ts`: `can(action, { userId, server })` — единая точка проверки прав; `isServerOwner` убран из компонентов.
- [x] URL Preview: `url-preview.tsx`, OG через `microlink.io`, module-level кеш.
- [x] Image lightbox: `createPortal`, ESC / клик-outside, `fixed inset-0 z-[9999]`.
- [x] Message grouping: consecutive-сообщения скрывают аватар/имя, `pt-3` между группами, hover-timestamp.
- [x] Typing indicator: три точки с `animate-bounce`, staggered delays, реальные имена.
- [x] Invite TTL + usage limits: `invite_expires_at` / `invite_max_uses` / `invite_used_count`, миграция, UI.
- [x] Message list virtualisation: `@tanstack/react-virtual`, dynamic heights, scroll-restoration, jump-to-message.
- [x] GIN-индекс: `idx_messages_content_gin` на `to_tsvector('russian', content)`.
- [x] Screen share frame-skip: FNV-64a hash кадра, `None` при неизменном экране.
- [x] Screen share resize: `Triangle` → `Nearest`, 720p→360p ~5ms → ~1-2ms.
- [x] `server-slice.ts` split: realtime сообщений → `message-slice.ts#initMessageRealtime`, 570 → 478 строк.
- [x] Screen share default: `1080p` → `720p`.
- [x] 55 Rust тестов (было 31) + 312 JS тестов (было 303).

## Готово (v0.3.0)

- [x] Single-instance: `tauri-plugin-single-instance` — второй запуск фокусирует первое окно.
- [x] Тест-сьют P1–P4: 303 JS (Vitest + jsdom) + 31 Rust (cargo test), все зелёные, mutation-verified.
- [x] E2E scaffold: `desktop/e2e/` — WebdriverIO + tauri-driver, `app.e2e.ts`, `single-instance.e2e.ts`.
- [x] CI BOM-guard в `release.yml` (проверка первых 3 байт `latest.json`).

## Готово (v0.2.19)

- [x] Auto-update: migrated to public `pompei1i/blok-releases` (private repo возвращал 403).
- [x] BOM fix: `UTF8Encoding($false)` вместо `[System.Text.Encoding.UTF8]`.
- [x] `gh release download --clobber`.

## Готово (v0.2.13–v0.2.18)

- [x] Screen share drag lag fix (GDI pause 150 мс на `tauri://move`).
- [x] WebRTC P2P DataChannels для screen share — убран Supabase rate limit.
- [x] Binary frame format: `[w:u32][h:u32][JPEG]`, backpressure guard 256 KB.
- [x] Multi-streamer picker: таб-бар при нескольких одновременных шарерах.
- [x] GDI in-flight guard `_captureInFlight`.
- [x] Auto-updater: ключи пересгенерированы, `productName` переименован в `blok`.
- [x] NSIS per-user install (`%LocalAppData%`, без UAC).

## Готово (v0.2.9)

- [x] Native noise suppression (Rust): адаптивный спектральный гейт.
- [x] Playback-aware echo cancellation (Rust): порог ×4 при воспроизведении.

## Готово (v0.2.1–v0.2.8)

- [x] DB-based presence heartbeat (30 с), «Был в сети X назад».
- [x] Supabase Storage для вложений (до 10 МБ), drag-and-drop.
- [x] Пагинация сообщений (30 за раз, scroll position сохраняется).
- [x] Invite-коды (CSPRNG, 8 символов).
- [x] Emoji-реакции: quick-picker, пилюли под сообщением, realtime + DB.
- [x] Закреплённые сообщения: pin bar, jump-to, unpin.
- [x] Reply system с quote-preview.
- [x] Редактирование и удаление сообщений.
- [x] DM-звонки: incoming/outgoing banners, голос + screen share в DM.
- [x] Mobile-адаптация: drawer sidebars, rem-based DM popup.
- [x] 6 языков (EN/RU/UA/PL/DE/ES), 165+ ключей.
- [x] Custom CSS live-inject.
- [x] Системный трей (минимизация вместо закрытия).
- [x] Push-уведомления + звуки.
- [x] RLS на всех таблицах, CSP, XSS-защита (DOMPurify).
- [x] Presence-точка на аватарах в чате (online/afk/dnd/offline).
- [x] GDI screen capture через Win32 API (`capture_screen_frame`).
- [x] Configurable screen share: FPS / resolution / JPEG quality.
- [x] Auto-update retry backoff: 3 с → 30 с → 5 мин.
