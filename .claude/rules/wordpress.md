---
paths:
  - '**/*.php'
  - '**/inc/**'
  - '**/template-parts/**'
  - '**/themes/**'
  - '**/plugins/**'
---

# WordPress (PHP 8+): правила Stage 2

You are an expert WordPress developer working inside an existing codebase.  
Follow these rules strictly. If something is unclear or missing, ask for clarification instead of guessing.

---

## 1. General Thinking & Approach

- Always prefer **native WordPress APIs** over custom implementations.
- Do **not overengineer** solutions.
- Keep code simple, readable, and maintainable.
- Explain solutions in **clear, simple language**.
- If unsure about requirements or context, **explicitly say so**.

---

## 2. Architecture & Structure

- **No business logic in templates**.
- `functions.php` is used **only** for:
  - hooks
  - filters
  - includes
  - bootstrapping

- All business logic must be placed in `/inc`.
- **One file = one responsibility**.
- Avoid tight coupling between components.

---

## 3. PHP, WordPress & Code Style

- Use **PHP 8+** features where appropriate.
- Follow **WordPress Coding Standards (WPCS)**.
- Always:
  - escape output (`esc_html`, `esc_attr`, `esc_url`, etc.)
  - sanitize input data (`sanitize_text_field`, `absint`, etc.)
- Do not output unescaped data under any circumstances.

---

## 4. Security

- Use **nonces** for all forms and state-changing actions.
- Always check user permissions using `current_user_can()`.
- Validate and sanitize all data in:
  - AJAX handlers
  - REST API endpoints
- Never trust `$_POST`, `$_GET`, `$_REQUEST`, or user input directly.
- Never use raw PDO or mysqli connections — all custom queries must go
  through `$wpdb` with `$wpdb->prepare()`. Never concatenate variables
  directly into SQL strings, even inside `$wpdb->prepare()` calls.

---

## 5. Plugins

- Each plugin must:
  - have a proper plugin header
  - include `ABSPATH` protection
- Always use a **unique prefix** for:
  - functions
  - hooks
  - constants
  - classes
- Plugin logic must **never** be placed inside a theme.

---

## 6. Themes & Assets

- Enqueue CSS and JS **only** via `wp_enqueue_style()` and `wp_enqueue_script()` inside `wp_enqueue_scripts` hook.
- Never use `<link>` or `<script>` tags directly in templates.
- Use `get_stylesheet_directory_uri()` for asset URLs.
- Use `get_template_part()` for reusable markup fragments.
- Pass data to template parts via `set_query_var()` or third argument (WP 5.5+).
- Avoid code duplication.
- Always pass explicit `$version` (e.g. filemtime() or theme version constant)
  to `wp_enqueue_style()` / `wp_enqueue_script()` for cache busting.
- Use `__()`, `_e()`, `esc_html__()`, `esc_attr__()` for all user-facing
  strings — never hardcode text directly in templates.

---

## 7. Output Expectations

- Provide production-ready code.
- Prefer explicit, readable solutions over clever shortcuts.
- Add comments only where they improve clarity.
- Do not invent APIs, hooks, or WordPress behavior.

If a requirement conflicts with WordPress best practices, explain why and suggest a safer alternative.

## 7b. SEO / GEO on WordPress

- The SEO plugin owns: `<title>`, meta description, canonical, robots meta, OG/Twitter,
  base JSON-LD (Organization, WebSite, BreadcrumbList), sitemap, `robots.txt`.
  The theme does NOT output them.
- The theme must: call `add_theme_support( 'title-tag' )`, have `wp_head()` before
  `</head>` and `wp_body_open()` after `<body>`. No hardcoded `<title>`, meta
  description, canonical or OG tags in `header.php`.
- The static Stage 1 `<head>` and JSON-LD are only a source of texts for the plugin
  fields. They are not copied into the theme.
- Custom JSON-LD (FAQPage, Person, LocalBusiness) only when the plugin cannot produce
  it. Before adding: check the plugin schema settings and the page source for duplicate
  types. FAQPage only with a visible FAQ block.
- Do not create physical `sitemap.xml` or `robots.txt` in the site root.
  `llms.txt` is a static file in the root.
- Content structure stays the theme's job (the plugin does not do it): one `h1`,
  heading hierarchy, answer-first, stable section `id`s, semantic tables and lists.
- After posadka check with view-source: one `<title>`, one canonical, no duplicate
  schema types.

## 8. Project Stack

- PHP 8.1+
- WordPress 6.x (custom theme, no page builder)
- Custom fields / repeaters: Redux Framework (metaboxes), not ACF
- CSS: Bootstrap 5 (row/col grid only, no CSS Grid utilities) +
  BEM-prefixed custom classes (`.lp-*`)
- JS: jQuery (bundled with Bootstrap/WP core) + vanilla JS in main.js,
  no build tools, no npm dependencies
- Assets self-hosted locally, no CDN
- Design tokens source of truth: `direction.md`, implemented as the `:root` block
  in `style.css` (carried over from static Stage 1 layout)
