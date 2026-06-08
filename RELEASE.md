# Release guide

## 1. Подготовка

Обнови версию в трёх файлах (например, `0.9.7` → `0.9.8`):

```
desktop/package.json              "version": "0.9.8"
desktop/src-tauri/tauri.conf.json "version": "0.9.8"
CHANGELOG.md                      добавь секцию ## [0.9.8] — YYYY-MM-DD
```

## 2. Коммит

```powershell
git add CHANGELOG.md desktop/package.json desktop/src-tauri/tauri.conf.json
git commit -m "feat: v0.9.8 — описание изменений"
```

Для хотфиксов (не релизных изменений):

```powershell
git add <файлы>
git commit -m "fix: краткое описание"
```

## 3. Тег и деплой

```powershell
git tag v0.9.8
git push origin main
git push origin v0.9.8
```

Пуш тега автоматически запускает GitHub Actions → собирает NSIS-инсталлятор → публикует релиз в `pompei1i/blok-releases`.

## 4. Проверка сборки

GitHub → репозиторий → **Actions** → последний запуск → проверь, что все шаги зелёные.

Если шаг **"Inject build secrets into .env"** показывает `VITE_BAIT_DEFAULT_KEY=***` — ключ вшит корректно.

## Структура commit message

```
feat:  новая функциональность
fix:   исправление бага
chore: обновление зависимостей, конфигов
docs:  только документация
```

## GitHub Secrets (Settings → Secrets → Actions)

| Secret | Назначение |
|--------|------------|
| `VITE_BAIT_DEFAULT_KEY` | Anthropic API key для b.ai.t |
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_TENOR_API_KEY` | Tenor GIF API |
| `TAURI_SIGNING_PRIVATE_KEY` | Подпись обновлений |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Пароль к ключу |
| `RELEASES_PAT` | PAT для записи в `blok-releases` |
