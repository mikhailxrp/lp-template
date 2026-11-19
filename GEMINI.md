# GEMINI.md — контекст проекта для Antigravity

Этот файл синхронизирует поведение Antigravity с Claude Code в рамках одного источника истины (`CLAUDE.md`, `.claude/rules/`, `.claude/skills/`).

## 1. Главные правила проекта (обязательно)

Перед любой работой с кодом, вёрсткой, контентом или аудитом **обязательно прочитай целиком** [CLAUDE.md](CLAUDE.md) через `read_file`.

> Почему не `@include`: размер `CLAUDE.md` превышает лимит авто-включения правил (24 КБ), поэтому прямое включение обрезало бы разделы GEO, a11y, чеклист и запреты.

Все правила из `CLAUDE.md` обязательны и имеют приоритет над общими привычками агента, но подчиняются `.claude/rules/general.md`.

## 2. Базовые правила (активны всегда)

@[general.md](.claude/rules/general.md)

@[lp-workflow.md](.claude/rules/lp-workflow.md)

## 3. Условные правила (как `paths:` в Claude Code)

- При работе с `*.html`, `*.php`, `llms.txt`, `robots.txt`, `sitemap.xml` (вёрстка, правка контента, SEO/GEO-аудит) — **прочитай** `.claude/rules/seo-geo.md`.
- При работе с `*.php`, `inc/**`, `template-parts/**`, `themes/**`, `plugins/**` (Stage 2, посадка на WordPress) — **прочитай** `.claude/rules/wordpress.md`.

## 4. Скиллы и соответствие инструментов

- Скиллы `lp-block`, `lp-check`, `seo-files`, `seo-audit`, `wp-slice` подключены через `.agents/skills.json` напрямую из `.claude/skills/`. Если пользователь пишет команду в формате `/lp-block`, `/lp-check`, `/seo-files`, `/seo-audit`, `/wp-slice` — активируй соответствующий скилл и следуй его `SKILL.md`.
- **Проверка вёрстки в браузере (375 / 768 / 1440):** вместо Playwright MCP используй встроенный субагент `browser` (Chrome DevTools).
- **Документация библиотек:** используй подключённый Context7 MCP (`resolve-library-id` / `query-docs`); если он недоступен — `search_web`.
- **Запуск скриптов проверки:** выполняй через `run_command` командой `node .claude/skills/<skill>/<script>.mjs` из корня проекта.
