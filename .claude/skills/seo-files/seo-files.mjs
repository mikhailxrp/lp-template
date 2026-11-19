// Создаёт заготовки sitemap.xml, robots.txt, llms.txt по страницам проекта. Без зависимостей.
// node seo-files.mjs <https://домен> [папка-проекта] [--force]
// Существующие файлы не перезаписывает без --force.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [domainArg, dirArg = '.'] = args.filter((a) => !a.startsWith('--'));
if (!domainArg || !/^https:\/\/[^/]+$/.test(domainArg.replace(/\/$/, ''))) {
  console.error('Usage: node seo-files.mjs https://example.ru [папка] [--force]');
  process.exit(2);
}
const domain = domainArg.replace(/\/$/, '');
const root = path.resolve(dirArg);
const SKIP = new Set(['assets', '.docs', '.claude', '.agents', '.wp-slices', 'node_modules', '.git']);

const list = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : list(path.join(dir, e.name));
    return e.name.endsWith('.html') ? [path.join(dir, e.name)] : [];
  });
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const pages = list(root).sort().map((file) => {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? rel);
  const description = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i)?.[1] ?? '';
  const url = `${domain}/${rel === 'index.html' ? '' : rel.replace(/\.html$/, '/')}`;
  return { rel, title, description, url };
});

const write = (name, content) => {
  const file = path.join(root, name);
  if (fs.existsSync(file) && !force) { console.log(`пропущен ${name}: уже есть (--force чтобы перезаписать)`); return; }
  fs.writeFileSync(file, content);
  console.log(`создан ${name}`);
};

const today = new Date().toISOString().slice(0, 10);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n')}
</urlset>
`);

write('robots.txt', `# ЗАМЕНИТЕ решения по AI-ботам на свои (пускать или нет).
User-agent: *
Allow: /

# AI-поиск и ассистенты (по умолчанию пускаем, чтобы сайт могли цитировать)
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: YandexAdditionalBot
Allow: /

Sitemap: ${domain}/sitemap.xml
`);

write('llms.txt', `# ЗАМЕНИТЬ: название компании или проекта

> ЗАМЕНИТЬ: 1-2 предложения: кто вы, что делаете, для кого, где работаете.

## Ключевые факты
- ЗАМЕНИТЬ: услуга / цены от ... / сроки / условия (только то, что есть на сайте)
- Контакты: ЗАМЕНИТЬ телефон, e-mail, адрес

## Страницы
${pages.map((p) => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`).join('\n')}
`);
console.log('\nПроверьте llms.txt: факты (ЗАМЕНИТЬ) заполняются вручную, без выдумок. Перед продом снимите noindex на страницах.');
