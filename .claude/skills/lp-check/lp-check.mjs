// Проверка статической вёрстки по чеклисту из CLAUDE.md (разделы 5-14).
// Без зависимостей: запуск `node .claude/skills/lp-check/lp-check.mjs [папка-проекта]`.
// Построчный и эвристический: возможны ложные срабатывания, читать код он не заменяет.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const CSS_FILE = 'assets/css/style.css';
const JS_FILE = 'assets/js/main.js';
const SKIP_DIRS = new Set(['vendor', 'node_modules', '.git', '.docs', '.claude', '.gigacode', '.template']);
const TITLE_MAX = 60;
const DESC_MIN = 140;
const DESC_MAX = 160;
const HEAVY_IMAGE_BYTES = 200 * 1024;
const MAX_FREE_PX = 2;
const MAX_RADIUS_PX = 16;
const MAX_COMPOUND_PARTS = 3;
const MAX_EXAMPLES = 5;
const ALLOWED_BREAKPOINTS = new Set([576, 768, 992, 1200, 1400]);
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const REQUIRED_META = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:locale'];
const PROJECT_FILES = ['robots.txt', 'llms.txt'];

const findings = [];
const add = (severity, rule, file, line, detail) => findings.push({ severity, rule, file, line, detail });

const read = (relative) => {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf8');
  } catch {
    return null;
  }
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const blank = (text, regex) => text.replace(regex, (match) => match.replace(/[^\n]/g, ' '));
const stem = (value) => path.basename(value).replace(/\.[a-z0-9]+$/i, '');

const parseAttrs = (source = '') => {
  const attrs = {};
  for (const m of source.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
};

const listHtml = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listHtml(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });

if (!fs.existsSync(root)) {
  console.error(`Папка не найдена: ${root}`);
  process.exit(2);
}

const htmlFiles = listHtml(root);
const usedClasses = new Set();
const htmlDataJs = new Set();
const pageNames = htmlFiles.map((file) => path.relative(root, file).split(path.sep).join('/'));

// ---------- HTML ----------
const checkHtml = (relative, original) => {
  const scripts = [...original.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let text = blank(original, /<!--[\s\S]*?-->/g);
  text = blank(text, /<script\b[^>]*>[\s\S]*?<\/script>/gi);
  text = blank(text, /<style\b[^>]*>[\s\S]*?<\/style>/gi);
  const at = (rule, severity, index, detail) => add(severity, rule, relative, lineOf(original, index), detail);

  const tags = [...text.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g)].map((m) => ({
    name: m[1].toLowerCase(),
    attrs: parseAttrs(m[2]),
    index: m.index,
  }));
  const find = (name) => tags.filter((tag) => tag.name === name);

  // основа документа
  const htmlTag = find('html')[0];
  if (!htmlTag?.attrs.lang) add('error', 'html-lang', relative, 1, 'нет lang на <html>');
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim();
  if (!title) add('error', 'title', relative, 1, 'нет <title>');
  else if (title.length > TITLE_MAX) add('warn', 'title-length', relative, 1, `${title.length} символов, лимит ${TITLE_MAX}`);

  const metas = find('meta');
  const metaContent = (key) => metas.find((m) => m.attrs.name === key || m.attrs.property === key)?.attrs.content;
  const description = metaContent('description');
  if (!description) add('error', 'meta-description', relative, 1, 'нет meta description');
  else if (description.length < DESC_MIN || description.length > DESC_MAX) {
    add('info', 'meta-description-length', relative, 1, `${description.length} символов, цель ${DESC_MIN}-${DESC_MAX}`);
  }
  if (!find('link').some((l) => l.attrs.rel === 'canonical')) add('warn', 'canonical', relative, 1, 'нет canonical');
  for (const key of REQUIRED_META) if (!metaContent(key)) add('warn', 'og-meta', relative, 1, `нет ${key}`);
  if (!metaContent('twitter:card')) add('warn', 'og-meta', relative, 1, 'нет twitter:card');
  if (/noindex/i.test(metaContent('robots') ?? '')) add('info', 'noindex', relative, 1, 'на странице noindex (dev-стенд), снять перед продом');
  if (/example\.ru/.test(original)) add('info', 'placeholder-domain', relative, 1, 'в canonical/OG остался example.ru');

  // заголовки
  const headings = tags.filter((tag) => /^h[1-6]$/.test(tag.name));
  const h1Count = headings.filter((h) => h.name === 'h1').length;
  if (h1Count !== 1) add('error', 'h1-count', relative, 1, `<h1>: ${h1Count}, нужен один`);
  headings.forEach((heading, i) => {
    const prev = i > 0 ? Number(headings[i - 1].name[1]) : 0;
    const level = Number(heading.name[1]);
    if (i > 0 && level - prev > 1) at('heading-jump', 'warn', heading.index, `${headings[i - 1].name} -> ${heading.name}`);
  });

  // изображения
  const images = find('img');
  images.forEach((img, i) => {
    const { alt, width, height, loading, src } = img.attrs;
    if (alt === undefined) at('img-alt', 'error', img.index, `нет alt: ${src}`);
    if (!width || !height) at('img-size', 'error', img.index, `нет width/height: ${src}`);
    if (i === 0 && loading !== 'eager' && !img.attrs.fetchpriority) {
      at('img-first-screen', 'info', img.index, `первое изображение без loading="eager"/fetchpriority: ${src}`);
    }
    if (i > 0 && loading !== 'lazy') at('img-lazy', 'warn', img.index, `нет loading="lazy": ${src}`);
    if (src && !/^(https?:|data:)/.test(src)) {
      const file = path.join(root, src.replace(/^\//, ''));
      if (fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        if (size > HEAVY_IMAGE_BYTES) at('img-heavy', 'warn', img.index, `${Math.round(size / 1024)} КБ: ${src}`);
        if (/\.(png|jpe?g)$/i.test(src)) at('img-format', 'info', img.index, `правило проекта: WebP основной формат: ${src}`);
      }
    }
  });

  // запрещённое в разметке
  tags.forEach((tag) => {
    if ('style' in tag.attrs) at('inline-style', 'error', tag.index, `<${tag.name} style=...>`);
    for (const name of Object.keys(tag.attrs)) {
      if (/^on[a-z]+$/.test(name)) at('inline-handler', 'error', tag.index, `<${tag.name} ${name}=...>`);
    }
    if (tag.attrs['data-js'] !== undefined) htmlDataJs.add(tag.attrs['data-js']);
    for (const cls of (tag.attrs.class ?? '').split(/\s+/)) if (cls.startsWith('lp-')) usedClasses.add(cls);
  });

  // CDN
  tags.forEach((tag) => {
    const url = tag.name === 'script' ? tag.attrs.src : tag.name === 'link' ? tag.attrs.href : null;
    if (!url || !/^(https?:)?\/\//.test(url)) return;
    const stylesheetLike = tag.name === 'script' || /stylesheet|preload|preconnect|prefetch/.test(tag.attrs.rel ?? '');
    if (stylesheetLike) at('cdn', 'error', tag.index, `внешний ресурс: ${url}`);
  });
  scripts.forEach((s) => {
    const src = parseAttrs(s[1]).src;
    if (src && /^(https?:)?\/\//.test(src)) add('error', 'cdn', relative, lineOf(original, s.index), `внешний скрипт: ${src}`);
  });

  // ссылки, id, якоря
  const ids = new Map();
  tags.forEach((tag) => {
    if (tag.attrs.id) ids.set(tag.attrs.id, (ids.get(tag.attrs.id) ?? 0) + 1);
  });
  ids.forEach((count, id) => {
    if (count > 1) add('error', 'duplicate-id', relative, 1, `id="${id}" встречается ${count} раз`);
  });
  find('a').forEach((link) => {
    const href = link.attrs.href;
    if (href === '#') at('placeholder-link', 'warn', link.index, 'href="#"');
    else if (href?.startsWith('#') && !ids.has(href.slice(1))) at('anchor-missing', 'error', link.index, `нет элемента ${href}`);
    if (link.attrs.target === '_blank' && !/noopener/.test(link.attrs.rel ?? '')) {
      at('noopener', 'warn', link.index, `target="_blank" без rel="noopener": ${href}`);
    }
  });

  // локальные файлы
  const refs = [
    ...find('a').map((t) => [t, t.attrs.href]),
    ...find('link').map((t) => [t, t.attrs.href]),
    ...find('script').map((t) => [t, t.attrs.src]),
    ...find('img').map((t) => [t, t.attrs.src]),
    ...find('use').map((t) => [t, t.attrs.href ?? t.attrs['xlink:href']]),
  ];
  scripts.forEach((s) => refs.push([{ index: s.index }, parseAttrs(s[1]).src]));
  refs.forEach(([tag, value]) => {
    if (!value || /^(#|https?:|\/\/|mailto:|tel:|javascript:|data:)/.test(value)) return;
    const clean = value.split('#')[0].split('?')[0];
    if (!clean || clean === '/') return;
    if (!fs.existsSync(path.join(root, clean.replace(/^\//, '')))) at('missing-file', 'error', tag.index, `файла нет: ${value}`);
  });

  // секции и WP-маркеры
  const sections = find('section');
  sections.forEach((section) => {
    if (!section.attrs.id) at('section-id', 'warn', section.index, '<section> без id');
    if (!section.attrs['aria-labelledby'] && !section.attrs['aria-label']) at('section-aria', 'warn', section.index, '<section> без aria-labelledby');
  });

  const regions = [];
  const wpStack = [];
  const stacks = {};
  const normalize = (name = '') => stem(name.replace(/\(\)$/, ''));
  const isInline = (name = '') => /\(/.test(name);
  for (const m of original.matchAll(/<!--([\s\S]*?)-->/g)) {
    const marker = m[1].trim().match(/^(\/)?@wp(-[a-z]+)?\s*:?\s*(\S*)/);
    if (!marker) continue;
    const [, closing, repeat, rawName] = marker;
    const stack = repeat ? (stacks[repeat] ??= []) : wpStack;
    if (!closing) {
      stack.push({ name: rawName, key: normalize(rawName), index: m.index });
      continue;
    }
    const key = normalize(rawName);
    let position = -1;
    if (repeat || !key) position = stack.length - 1;
    else {
      for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i].key === key) { position = i; break; }
      if (position < 0) for (let i = stack.length - 1; i >= 0; i -= 1) if (!isInline(stack[i].name)) { position = i; break; }
    }
    if (position < 0) {
      at('wp-marker', 'error', m.index, `закрывающий маркер без открывающего${rawName ? `: ${rawName}` : ''}`);
      continue;
    }
    const skipped = stack.splice(position);
    const open = skipped[0];
    skipped.slice(1).filter((x) => !isInline(x.name)).forEach((x) => at('wp-marker', 'error', x.index, `маркер не закрыт: ${x.name}`));
    if (!repeat) {
      regions.push({ start: open.index, end: m.index });
      if (!isInline(open.name) && stem(open.name) !== rawName) {
        at('wp-marker-name', 'info', m.index, `открыт как ${stem(open.name)}.php, закрыт как "${rawName}"`);
      }
    }
  }
  [...wpStack, ...Object.values(stacks).flat()]
    .filter((open) => !isInline(open.name))
    .forEach((open) => at('wp-marker', 'error', open.index, `маркер не закрыт: ${open.name || '@wp-repeat'}`));
  sections.forEach((section) => {
    if (!regions.some((r) => r.start < section.index && section.index < r.end)) {
      at('wp-marker-missing', 'warn', section.index, `<section id="${section.attrs.id ?? ''}"> вне @wp-маркера`);
    }
  });

  // кнопки, nav, поля форм
  for (const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = parseAttrs(m[1]);
    const inner = m[2].replace(/<[^>]*>/g, '').trim();
    if (!inner && !attrs['aria-label'] && !attrs['aria-labelledby']) at('button-name', 'error', m.index, 'кнопка без текста и aria-label');
  }
  find('nav').forEach((nav) => {
    if (!nav.attrs['aria-label'] && !nav.attrs['aria-labelledby']) at('nav-label', 'warn', nav.index, '<nav> без aria-label');
  });
  const labelFor = new Set(find('label').map((l) => l.attrs.for).filter(Boolean));
  find('input').concat(find('select'), find('textarea')).forEach((field) => {
    if (['hidden', 'submit', 'button'].includes(field.attrs.type)) return;
    if (field.attrs['aria-label'] || field.attrs['aria-labelledby']) return;
    if (!field.attrs.id || !labelFor.has(field.attrs.id)) at('field-label', 'warn', field.index, `поле без <label for>: ${field.attrs.id ?? field.attrs.name ?? field.name}`);
  });

  // JSON-LD
  const types = [];
  for (const s of scripts) {
    if (parseAttrs(s[1]).type !== 'application/ld+json') continue;
    const line = lineOf(original, s.index);
    try {
      const data = JSON.parse(s[2]);
      const type = data['@type'];
      types.push(type);
      if (type === 'FAQPage') {
        const visible = (text.match(/class="[^"]*\baccordion-item\b/g) ?? []).length;
        const declared = Array.isArray(data.mainEntity) ? data.mainEntity.length : 0;
        if (!visible) add('error', 'jsonld-faq', relative, line, 'FAQPage без видимого FAQ-блока на странице');
        else if (visible !== declared) add('warn', 'jsonld-faq', relative, line, `в разметке ${visible} вопросов, в JSON-LD ${declared}`);
      }
    } catch (error) {
      add('error', 'jsonld-invalid', relative, line, `невалидный JSON: ${error.message}`);
    }
  }
  const isInner = relative !== 'index.html';
  if (!types.length) add('warn', 'jsonld-missing', relative, 1, 'нет JSON-LD');
  if (isInner && !types.includes('BreadcrumbList')) add('warn', 'jsonld-breadcrumb', relative, 1, 'нет BreadcrumbList на внутренней странице');
  if (/id="faq"/.test(text) && !types.includes('FAQPage')) add('warn', 'jsonld-faq', relative, 1, 'есть #faq, но нет FAQPage');
};

// ---------- CSS ----------
const cssInfo = { defined: new Set(), classes: new Set() };

const checkCss = (relative, original) => {
  const clean = blank(original, /\/\*[\s\S]*?\*\//g);
  const rawLines = original.split('\n');
  const lines = clean.split('\n');
  const defined = new Set();
  const used = new Map();
  const stack = [];
  let pending = '';
  let hasMotion = false;

  const addCss = (severity, rule, line, detail) => add(severity, rule, relative, line, detail);

  const openRule = (selector, lineNo) => {
    stack.push(selector);
    if (selector.startsWith('@')) {
      const query = selector.match(/\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/);
      if (query) {
        const [, kind, value] = query;
        if (kind === 'max') addCss('warn', 'css-max-width-query', lineNo, `max-width вместо mobile-first: ${selector}`);
        else if (!ALLOWED_BREAKPOINTS.has(Number(value))) addCss('warn', 'css-breakpoint', lineNo, `нестандартный брейкпоинт ${value}px`);
      }
      return;
    }
    if (stack.some((s) => s.startsWith('@keyframes'))) return;
    for (const single of selector.split(',')) {
      const trimmed = single.trim();
      if (!trimmed) continue;
      if (/(^|[\s>+~(])#[a-zA-Z_-]/.test(trimmed)) addCss('error', 'css-id-selector', lineNo, trimmed);
      const parts = trimmed.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      if (parts.length > MAX_COMPOUND_PARTS) addCss('warn', 'css-nesting', lineNo, `${parts.length} уровней: ${trimmed}`);
      for (const m of trimmed.matchAll(/\.([a-zA-Z_][\w-]*)/g)) if (m[1].startsWith('lp-')) cssInfo.classes.add(m[1]);
    }
  };

  const checkDeclaration = (prop, value, lineNo) => {
    const top = stack[stack.length - 1] ?? '';
    const inRoot = stack.some((s) => s.startsWith(':root'));
    const inFontFace = top.startsWith('@font-face');
    const inKeyframes = stack.some((s) => s.startsWith('@keyframes'));
    if (/^(transition|animation)/.test(prop)) hasMotion = true;
    if (prop.startsWith('--')) defined.add(prop);
    for (const m of value.matchAll(/var\((--[\w-]+)/g)) if (!used.has(m[1])) used.set(m[1], lineNo);
    if (inRoot || inFontFace) return;

    const noVars = value.replace(/var\([^)]*\)/g, '');
    if (!value.includes('url(') && /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i.test(noVars)) {
      addCss('error', 'css-color-literal', lineNo, `${prop}: ${value.trim()}`);
    }
    if (prop === 'font-family' && !/var\(--lp-font|inherit/.test(value)) addCss('error', 'css-font-literal', lineNo, `${prop}: ${value.trim()}`);
    if (/!important/.test(value)) {
      const justified = /\/\*/.test(rawLines[lineNo - 1]) || /\/\*|\*\//.test(rawLines[lineNo - 2] ?? '');
      if (!justified) addCss('warn', 'css-important', lineNo, `!important без комментария: ${prop}`);
    }
    if (/^outline(-style)?$/.test(prop) && /^(none|0)\b/.test(value.trim())) addCss('warn', 'css-outline', lineNo, `${prop}: ${value.trim()}: проверьте замену фокуса`);
    if (inKeyframes) return;
    if (/^(padding|margin|gap|row-gap|column-gap|font-size|border-radius)/.test(prop) || /^(padding|margin)-/.test(prop)) {
      const bad = [...noVars.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1])).filter((n) => n > MAX_FREE_PX);
      if (bad.length) addCss('warn', 'css-magic-px', lineNo, `${prop}: ${value.trim()}`);
    }
    if (/^border(-[a-z]+)*-radius$|^border-radius$/.test(prop)) {
      const big = [...noVars.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1])).some((n) => n > MAX_RADIUS_PX);
      if (big) addCss('warn', 'css-radius', lineNo, `скругление больше ${MAX_RADIUS_PX}px: ${value.trim()}`);
    }
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;

    if (opens) {
      const selector = (pending + ' ' + line.split('{')[0]).trim();
      pending = '';
      openRule(selector, lineNo);
      const body = line.slice(line.indexOf('{') + 1);
      for (const decl of body.split(';')) {
        const m = decl.replace(/}/g, '').match(/^\s*([a-z-]+|--[\w-]+)\s*:\s*(.+?)\s*$/i);
        if (m) checkDeclaration(m[1].toLowerCase(), m[2], lineNo);
      }
      for (let c = 0; c < closes; c += 1) stack.pop();
      return;
    }
    if (closes) {
      for (let c = 0; c < closes; c += 1) stack.pop();
      return;
    }
    const decl = trimmed.match(/^([a-z-]+|--[\w-]+)\s*:\s*(.+?);?\s*$/i);
    if (decl && stack.length && !trimmed.endsWith(',')) {
      checkDeclaration(decl[1].toLowerCase(), decl[2], lineNo);
      return;
    }
    const top = stack[stack.length - 1] ?? '';
    if (stack.length && !/^@(media|supports|layer|container)/.test(top)) return;
    pending += ` ${trimmed}`;
  });

  used.forEach((lineNo, name) => {
    if (!defined.has(name) && !name.startsWith('--bs-')) addCss('error', 'css-undefined-var', lineNo, `${name} нигде не объявлена`);
  });
  const lpTokens = [...defined].filter((name) => name.startsWith('--lp-'));
  const unused = lpTokens.filter((name) => !used.has(name));
  if (unused.length) addCss('info', 'css-unused-token', 1, `${unused.length} токенов не используются: ${unused.slice(0, 6).join(', ')}${unused.length > 6 ? '...' : ''}`);
  if (hasMotion && !/prefers-reduced-motion/.test(clean)) addCss('warn', 'css-reduced-motion', 1, 'есть transition/animation, но нет @media (prefers-reduced-motion)');
  cssInfo.defined = defined;
};

// ---------- JS ----------
const checkJs = (relative, original) => {
  const clean = blank(original, /\/\*[\s\S]*?\*\//g).replace(/^\s*\/\/.*$/gm, '');
  const at = (severity, rule, index, detail) => add(severity, rule, relative, lineOf(original, index), detail);
  if (!/^\s*(\(function|\(\(\) =>|;\(function)/.test(clean)) add('warn', 'js-iife', relative, 1, 'файл не начинается с IIFE: риск глобальных переменных');
  if (!/'use strict'|"use strict"/.test(clean)) add('info', 'js-strict', relative, 1, 'нет "use strict"');

  for (const m of clean.matchAll(/(?:querySelector(?:All)?|closest|matches)\(\s*(['"`])(.*?)\1/g)) {
    if (/\.[a-zA-Z_]/.test(m[2].replace(/\[[^\]]*\]/g, ''))) {
      at('warn', 'js-class-hook', m.index, `класс как JS-хук (нужен data-js): ${m[2]}`);
    }
    for (const attr of m[2].matchAll(/data-js="([^"]+)"/g)) if (!attr[1].includes('${') && !htmlDataJs.has(attr[1])) {
      at('warn', 'js-hook-missing', m.index, `data-js="${attr[1]}" не найден ни в одном html`);
    }
  }
  for (const m of clean.matchAll(/\bconsole\.(log|debug)\(/g)) at('warn', 'js-console', m.index, m[0]);
  for (const m of clean.matchAll(/\bvar\s+\w+/g)) at('info', 'js-var', m.index, m[0]);
  for (const m of clean.matchAll(/['"`](lp-[\w-]+)['"`]/g)) usedClasses.add(m[1]);
};

// ---------- запуск ----------
for (const file of htmlFiles) {
  checkHtml(path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8'));
}
const css = read(CSS_FILE);
if (css) checkCss(CSS_FILE, css);
else add('warn', 'no-css', CSS_FILE, 1, 'файл не найден');
const js = read(JS_FILE);
if (js) checkJs(JS_FILE, js);
else add('info', 'no-js', JS_FILE, 1, 'файл не найден');

for (const cls of usedClasses) {
  if (cssInfo.classes.size && ![...cssInfo.classes].some((c) => c === cls || c.startsWith(`${cls}__`) || c.startsWith(`${cls}--`))) add('warn', 'class-not-in-css', CSS_FILE, 1, `${cls} есть в html/js, но не в style.css`);
}
const dead = [...cssInfo.classes].filter((cls) => !usedClasses.has(cls));
if (dead.length) add('info', 'css-dead-class', CSS_FILE, 1, `${dead.length} классов lp-* не найдено в html/js: ${dead.slice(0, 6).join(', ')}${dead.length > 6 ? '...' : ''}`);
for (const name of PROJECT_FILES) {
  if (!fs.existsSync(path.join(root, name))) add('warn', 'project-file', name, 1, `нет ${name} (описан в CLAUDE.md)`);
}

// ---------- отчёт ----------
const groups = new Map();
for (const f of findings) {
  const key = `${f.severity}|${f.rule}`;
  groups.set(key, [...(groups.get(key) ?? []), f]);
}
const ordered = [...groups.entries()].sort(([a], [b]) => {
  const [sa, ra] = a.split('|');
  const [sb, rb] = b.split('|');
  return SEVERITY_ORDER[sa] - SEVERITY_ORDER[sb] || ra.localeCompare(rb);
});

console.log(`Проверено: ${pageNames.length} html (${pageNames.join(', ')}), ${css ? 'style.css' : 'без css'}, ${js ? 'main.js' : 'без js'}\n`);
if (!ordered.length) console.log('OK: замечаний нет.');
for (const [key, items] of ordered) {
  const [severity, rule] = key.split('|');
  console.log(`[${severity}] ${rule} (${items.length})`);
  items.slice(0, MAX_EXAMPLES).forEach((f) => console.log(`  ${f.file}:${f.line}  ${f.detail}`));
  if (items.length > MAX_EXAMPLES) console.log(`  ... и ещё ${items.length - MAX_EXAMPLES}`);
}
const counts = { error: 0, warn: 0, info: 0 };
findings.forEach((f) => (counts[f.severity] += 1));
console.log(`\nИтого: ${counts.error} ошибок, ${counts.warn} предупреждений, ${counts.info} заметок`);
process.exit(counts.error ? 1 : 0);
