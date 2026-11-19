// SEO/GEO-аудит статических страниц. Без зависимостей: node seo-audit.mjs [папка-проекта]
// Эвристический (regex). Проверяет то, что можно проверить кодом; смысл текста оценивает Claude по SKILL.md.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const SKIP_DIRS = new Set(['assets', '.docs', '.claude', '.agents', '.wp-slices', 'node_modules', '.git', 'vendor']);
const ANSWER_MAX_CHARS = 320; // первый абзац после заголовка: ответ в 1-2 предложениях
const MIN_WORDS_HOME = 300;
const STUFFING_SHARE = 0.035;
const STUFFING_MIN_COUNT = 15;
const MAX_EXAMPLES = 5;

const WEAK_ANCHORS = /^(подробнее|здесь|тут|читать далее|узнать больше|далее|ссылка|нажмите|жми|читать)$/i;
const CONTEXT_PHRASES = /(как сказано выше|как указано выше|как мы писали|см\. выше|об этом ниже|этот способ|данный метод|как уже говорилось)/i;
const FLUFF_OPENERS = /^(добро пожаловать|мы рады|в современном мире|в наше время|в эпоху|сегодня сложно представить)/i;
const GENERIC_HEADINGS = new Set(['преимущества', 'о нас', 'услуги', 'контакты', 'отзывы', 'цены', 'наши преимущества', 'почему мы', 'как мы работаем', 'о компании', 'наши услуги']);
const STOP = new Set(['который', 'которые', 'также', 'можно', 'нужно', 'будет', 'более', 'после', 'когда', 'чтобы', 'этого', 'только', 'через', 'очень', 'между']);

const findings = [];
const add = (severity, rule, where, detail) => findings.push({ severity, rule, where, detail });

const stripTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const attrs = (source) => Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[3] ?? m[4]]));
const digits = (value) => value.replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');

const listPages = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listPages(path.join(dir, entry.name));
    return entry.name.endsWith('.html') ? [path.join(dir, entry.name)] : [];
  });

if (!fs.existsSync(root)) { console.error(`Нет папки: ${root}`); process.exit(2); }
const pageFiles = listPages(root).sort();
if (!pageFiles.length) { console.error('HTML-страниц не найдено'); process.exit(2); }

const titles = new Map();
const descriptions = new Map();
const phones = new Map();
const canonicalHosts = new Set();
const pageNames = [];

for (const file of pageFiles) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  pageNames.push(rel);
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const noComments = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const body = noComments.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
  const at = (severity, rule, index, detail) => add(severity, rule, `${rel}:${lineOf(raw, index)}`, detail);
  const tags = (name) => [...body.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => ({ index: m.index, attrs: attrs(m[1]) }));
  const visible = stripTags(body.replace(/<head[\s\S]*?<\/head>/i, ''));

  // title / description / canonical / OG
  const title = stripTags(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = tags('meta').find((m) => m.attrs.name === 'description')?.attrs.content ?? '';
  titles.set(title, [...(titles.get(title) ?? []), rel]);
  if (description) descriptions.set(description, [...(descriptions.get(description) ?? []), rel]);
  const canonical = tags('link').find((l) => l.attrs.rel === 'canonical')?.attrs.href;
  const ogUrl = tags('meta').find((m) => m.attrs.property === 'og:url')?.attrs.content;
  const ogImage = tags('meta').find((m) => m.attrs.property === 'og:image')?.attrs.content;
  if (canonical && !/^https:\/\//.test(canonical)) add('error', 'canonical-relative', rel, `canonical должен быть абсолютным https-адресом: ${canonical}`);
  if (canonical && ogUrl && canonical !== ogUrl) add('warn', 'canonical-og-mismatch', rel, `canonical ${canonical} ≠ og:url ${ogUrl}`);
  if (canonical?.startsWith('https://')) canonicalHosts.add(new URL(canonical).host);
  if (ogImage && !/^https:\/\//.test(ogImage)) add('warn', 'og-image-relative', rel, `og:image должен быть абсолютным: ${ogImage}`);

  // заголовки
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (h1s.length !== 1) add('error', 'h1-count', rel, `h1: ${h1s.length}, нужен ровно один`);
  else {
    const words = (text) => new Set(text.toLowerCase().match(/[а-яёa-z]{4,}/g) ?? []);
    const h1Words = words(stripTags(h1s[0][1]));
    const titleWords = words(title);
    if (![...h1Words].some((w) => [...titleWords].some((t) => t.slice(0, 5) === w.slice(0, 5)))) {
      add('warn', 'h1-title-unrelated', rel, `h1 «${stripTags(h1s[0][1]).slice(0, 50)}» и title не пересекаются по смыслу`);
    }
  }
  for (const m of body.matchAll(/<h([2-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2]).toLowerCase().replace(/[.!:]/g, '');
    if (GENERIC_HEADINGS.has(text)) at('info', 'heading-generic', m.index, `«${stripTags(m[2])}»: вне контекста непонятно, о чём секция (GEO любит конкретные заголовки)`);
  }

  // answer-first и самодостаточность
  for (const m of body.matchAll(/<h([2-3])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-6]\b|$)/gi)) {
    const paragraph = m[3].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (!paragraph) continue;
    const text = stripTags(paragraph[1]);
    if (!text) continue;
    const heading = stripTags(m[2]);
    if (text.length > ANSWER_MAX_CHARS) at('warn', 'answer-first', m.index, `после «${heading.slice(0, 40)}» первый абзац ${text.length} симв.: ответ должен быть в 1-2 предложениях`);
    if (FLUFF_OPENERS.test(text)) at('warn', 'fluff-opener', m.index, `«${heading.slice(0, 40)}» начинается с воды: «${text.slice(0, 50)}»`);
  }
  for (const m of visible.matchAll(new RegExp(CONTEXT_PHRASES, 'gi'))) {
    add('warn', 'not-self-contained', rel, `«${m[0]}»: абзац не должен зависеть от соседних (LLM цитирует куски)`);
  }

  // ссылки
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(m[1]);
    const text = stripTags(m[2]);
    if (WEAK_ANCHORS.test(text) && !(a['aria-label'] ?? '').includes(' ')) at('warn', 'weak-anchor', m.index, `анкор «${text}» без смысла`);
    if (a.href?.startsWith('tel:')) phones.set(digits(a.href), [...(phones.get(digits(a.href)) ?? []), rel]);
  }

  // картинки
  for (const img of tags('img')) {
    const a = img.attrs;
    if (a.alt === undefined) at('error', 'img-alt-missing', img.index, `нет alt: ${a.src}`);
    else if (!a.alt.trim() && !(a['aria-hidden'] === 'true' || a.role === 'presentation')) at('info', 'img-alt-empty', img.index, `пустой alt (ок только для декора): ${a.src}`);
    else if (/\.(jpe?g|png|webp|svg)$|^img[_-]?\d+/i.test(a.alt)) at('warn', 'img-alt-filename', img.index, `alt похож на имя файла: ${a.alt}`);
    if (!a.width || !a.height) at('info', 'img-size-missing', img.index, `нет width/height (сдвиг вёрстки CLS): ${a.src}`);
  }

  // таблицы
  for (const m of body.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    if (!/<caption\b/i.test(m[0])) at('warn', 'table-caption', m.index, '<table> без <caption>');
    if (/<th\b(?![^>]*scope=)/i.test(m[0])) at('warn', 'table-th-scope', m.index, '<th> без scope');
  }

  // FAQ-вопросы
  const faq = body.match(/id="faq"[\s\S]*?(?=<\/section>)/i)?.[0] ?? '';
  for (const m of faq.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const q = stripTags(m[1]);
    if (!q.endsWith('?')) add('info', 'faq-not-question', rel, `вопрос FAQ без «?»: ${q.slice(0, 50)}`);
  }

  // JSON-LD
  const faqText = visible.toLowerCase();
  for (const m of noComments.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; } // невалидный JSON ловит lp-check
    const items = Array.isArray(data) ? data : data['@graph'] ?? [data];
    for (const item of items) {
      const type = item['@type'];
      if (!String(item['@context'] ?? data['@context'] ?? '').includes('schema.org')) at('warn', 'jsonld-context', m.index, `${type}: нет @context schema.org`);
      if (['Organization', 'LocalBusiness'].includes(type)) {
        if (!item.name || !item.url) at('warn', 'jsonld-org-fields', m.index, `${type}: нужны name и url`);
        if (item.telephone) {
          const pageDigits = [...visible.matchAll(/\+?\d[\d\s()-]{9,}\d/g)].map((x) => digits(x[0]));
          const tel = digits(item.telephone);
          if (tel.length >= 10 && (pageDigits.length || phones.size) && !pageDigits.includes(tel) && !phones.has(tel)) {
            at('warn', 'nap-mismatch', m.index, `телефон из JSON-LD ${item.telephone} не найден на странице`);
          }
        }
      }
      if (type === 'FAQPage' && Array.isArray(item.mainEntity)) {
        for (const q of item.mainEntity) {
          const name = String(q.name ?? '').toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
          if (name && !faqText.includes(name)) at('error', 'jsonld-faq-not-visible', m.index, `вопрос из JSON-LD нет в видимом тексте: «${q.name?.slice(0, 50)}»`);
        }
      }
      if (['AggregateRating', 'Review'].includes(type) || item.aggregateRating || item.review) {
        at('warn', 'jsonld-rating', m.index, 'рейтинг/отзывы в разметке: только если реальные отзывы видны на странице (иначе санкции)');
      }
    }
  }

  // текст в целом
  const words = visible.toLowerCase().match(/[а-яёa-z]{5,}/g) ?? [];
  if (rel === 'index.html' && words.length < MIN_WORDS_HOME) add('info', 'thin-content', rel, `${words.length} слов в тексте, мало для главной`);
  const freq = new Map();
  words.filter((w) => !STOP.has(w)).forEach((w) => freq.set(w.slice(0, 6), (freq.get(w.slice(0, 6)) ?? 0) + 1));
  const [top, count] = [...freq].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (count >= STUFFING_MIN_COUNT && count / words.length > STUFFING_SHARE) add('info', 'keyword-density', rel, `основа «${top}…» встречается ${count} раз (${((count / words.length) * 100).toFixed(1)}%): проверьте переспам`);
  if (/<(section|div)\b[^>]*\shidden(?=[\s>=])|(?:style="[^"]*display:\s*none)/i.test(body)) add('info', 'hidden-content', rel, 'есть скрытые блоки: контент должен быть в DOM, но не прятаться от пользователя без причины');
}

titles.forEach((files, title) => { if (files.length > 1) add('error', 'title-duplicate', files.join(', '), `одинаковый title: «${title.slice(0, 50)}»`); });
descriptions.forEach((files, d) => { if (files.length > 1) add('warn', 'description-duplicate', files.join(', '), `одинаковый description: «${d.slice(0, 50)}»`); });
if (phones.size > 1) add('warn', 'nap-phones', 'сайт', `разных телефонов в tel: ссылках ${phones.size}: ${[...phones.keys()].join(', ')}`);
if (canonicalHosts.size > 1) add('warn', 'canonical-hosts', 'сайт', `разные хосты в canonical: ${[...canonicalHosts].join(', ')}`);

// файлы сайта
const readSite = (name) => { const f = path.join(root, name); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const robots = readSite('robots.txt');
if (robots === null) add('warn', 'robots-missing', 'robots.txt', 'файла нет');
else {
  if (!/^sitemap:\s*https?:\/\//im.test(robots)) add('warn', 'robots-sitemap', 'robots.txt', 'нет строки Sitemap: https://...');
  if (/^disallow:\s*\/\s*$/im.test(robots)) add('info', 'robots-disallow-all', 'robots.txt', 'сайт закрыт целиком (ок на dev, снять перед продом)');
  const bots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'YandexAdditionalBot', 'Google-Extended'].filter((b) => !new RegExp(b, 'i').test(robots));
  if (bots.length) add('info', 'robots-ai-bots', 'robots.txt', `не упомянуты AI-боты: ${bots.join(', ')}. Решите явно: пускать или нет`);
}
const sitemap = readSite('sitemap.xml');
if (sitemap === null) add('warn', 'sitemap-missing', 'sitemap.xml', 'файла нет');
else {
  const locs = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) add('error', 'sitemap-empty', 'sitemap.xml', 'нет ни одного <loc>');
  pageNames.forEach((name) => {
    const slug = name === 'index.html' ? '' : name.replace(/\.html$/, '');
    if (!locs.some((l) => l.replace(/\/$/, '').endsWith(slug.replace(/\/$/, '')))) add('warn', 'sitemap-page-missing', 'sitemap.xml', `страницы ${name} нет в sitemap`);
  });
}
const llms = readSite('llms.txt');
if (llms === null) add('warn', 'llms-missing', 'llms.txt', 'файла нет');
else {
  if (/ЗАМЕНИТЬ/.test(llms)) add('warn', 'llms-placeholder', 'llms.txt', 'остались заготовки «ЗАМЕНИТЬ»: впишите факты');
  if (!/^# \S/m.test(llms)) add('warn', 'llms-h1', 'llms.txt', 'нет заголовка первого уровня «# Название»');
  if (!/^>\s*\S/m.test(llms)) add('warn', 'llms-summary', 'llms.txt', 'нет краткого описания в цитате «> ...»');
  if ((llms.match(/\]\(https?:\/\//g) ?? []).length < Math.min(pageNames.length, 3)) add('warn', 'llms-links', 'llms.txt', 'мало ссылок на ключевые страницы');
  if (!/(\+\d|@)/.test(llms)) add('info', 'llms-contacts', 'llms.txt', 'нет контактов (телефон или e-mail)');
}

// отчёт
const order = { error: 0, warn: 1, info: 2 };
const groups = new Map();
findings.forEach((f) => { const key = `${f.severity}|${f.rule}`; groups.set(key, [...(groups.get(key) ?? []), f]); });
console.log(`SEO/GEO: страниц ${pageNames.length} (${pageNames.join(', ')})\n`);
[...groups].sort((a, b) => order[a[0].split('|')[0]] - order[b[0].split('|')[0]] || a[0].localeCompare(b[0])).forEach(([key, list]) => {
  const [severity, rule] = key.split('|');
  console.log(`[${severity}] ${rule} (${list.length})`);
  list.slice(0, MAX_EXAMPLES).forEach((f) => console.log(`  ${f.where}  ${f.detail}`));
  if (list.length > MAX_EXAMPLES) console.log(`  ... и ещё ${list.length - MAX_EXAMPLES}`);
});
const count = (s) => findings.filter((f) => f.severity === s).length;
console.log(`\nИтого: ${count('error')} ошибок, ${count('warn')} предупреждений, ${count('info')} заметок`);
console.log('Скрипт проверяет только форму. Смысл текста, полноту ответов и факты проверяет Claude по SKILL.md.');
process.exit(count('error') ? 1 : 0);
