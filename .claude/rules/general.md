# Общие принципы (грузятся всегда)

## Universal

- One file = one responsibility
- Always handle errors explicitly (try/catch, fallback UI)
- No magic numbers — use named constants
- Prefer simple over clever — if it needs a comment to understand, rewrite it
- Never hardcode secrets — always use .env
- Before writing code — make sure you understand the task fully
- If task is unclear — ask ONE question before coding
- Always use Context7 to fetch up-to-date documentation
  before writing code that uses any library or external API

## JavaScript / TypeScript

- Prettier: 2 spaces, single quotes, semicolons
- ES Modules, async/await, arrow functions
- Functional style only — no class-based components
- Avoid `any` in TypeScript — use proper types or `unknown`

## PHP

- PSR-12 code style
- Always add `declare(strict_types=1)` at the top of every file
- Prefer functions over classes unless OOP is clearly justified
- Use `match` over `switch`, `??` over long ternary chains
- Always validate and sanitize external input
- No inline SQL in standalone PHP — use PDO with prepared statements only
  (does NOT apply inside WordPress — see WordPress section below)
- Separate config / routing / templates — even without a framework
- No mixed PHP/HTML — logic and presentation must be in separate files
- ⚠️ Applies starting Stage 2 (WordPress posadka) only.
  During Stage 1 (static HTML/CSS/JS layout) — no PHP files at all.

- ⚠️ Inside a WordPress theme (Stage 2) the rules above change:
  - Code style: WPCS (see `wordpress.md`) instead of PSR-12.
  - "No mixed PHP/HTML" does not apply to `template-parts/`: markup stays as in the
    static layout, PHP there is output only (escaping, loops, `get_template_part()`).
    Logic goes to `/inc`.
  - No Composer / PSR-4 in the theme: files are loaded with `require_once` from
    `functions.php`.
  - "Separate config / routing" does not apply: routing belongs to WP core.
  - `declare(strict_types=1)` stays in `/inc` files.

## HTML

- Semantic tags first: `<main>`, `<section>`, `<article>`, `<nav>`
- Accessibility required: `alt` on images, `aria-*` and `role` where needed
- No inline styles — use classes

## CSS

- Mobile-first by default
- BEM for plain CSS projects; Tailwind for component-based projects;
  Bootstrap grid (row/col only, no CSS Grid utilities) + BEM-prefixed
  custom classes for Bootstrap-based projects
- Use CSS custom properties instead of magic numbers (`--spacing-md: 1rem`)
- Never hardcode colors, fonts, or spacing values — always reference
  CSS custom properties from the project's actual design token source
  (e.g. `direction.md` + `:root` in `style.css`, a `globals.css` `@theme {}`
  block for Tailwind v4, `tokens.css`, or equivalent theme config —
  whichever the project defines; check for one before hardcoding)
- Self-host all third-party CSS/JS assets locally — no CDN links
- Avoid `!important` except for utility overrides
- Group properties: positioning → box model → typography → visual → animation
  (applies to authored CSS rules; not applicable to utility-class ordering
  in Tailwind-based projects)
