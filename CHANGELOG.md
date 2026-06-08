# Changelog

## [0.9.14] — 2026-06-08

### Added
- **XP + Levels** — каждое сообщение даёт +5 XP. Уровни 1–10+ с цветовыми тирами (серый → синий → фиолетовый → золотой). Значок уровня рядом с ником в списке участников; прогресс-бар в карточке профиля и UserBar
- **Rich Presence** — кнопка `+ set activity` в UserBar открывает пикер с 6 пресетами (Gaming, Listening, Studying, Working, Watching, AFK). Активность синхронизируется в реальном времени и видна рядом с ником
- **Daily Quests** — новая вкладка «quests» в правом сайдбаре. 3 ежедневных квеста: Send 5 messages (+50 XP), Send 15 messages (+100 XP), React to 5 messages (+75 XP). Прогресс считается автоматически через DB-триггеры; кнопка «Claim XP» атомарно начисляет награду
- **Редизайн карточки профиля** — новый лейаут с level badge на аватарке, presence pill, XP progress bar под именем, кнопки Message и Call для чужих профилей
- **Friends list: Online/Offline секции** — друзья разбиты на Online/Offline с возможностью свернуть. Контекстное меню (ПКМ) с View Profile, Message, Call, Invite to Server, Remove Friend
- **Отключён системный контекст-меню** — ПКМ в пустых местах больше не открывает браузерное меню Chromium

### Fixed
- Карточка профиля показывала "Online" из поля `statusMessage` вместо реального presence-статуса

### Database
- `server_members.xp INTEGER DEFAULT 0` + триггер `trg_message_xp` (+5 XP на каждое сообщение)
- `user_presence.activity TEXT` для rich presence
- Таблицы `daily_quest_progress`, `daily_quest_claims` + триггеры и RPC `claim_quest_xp`
