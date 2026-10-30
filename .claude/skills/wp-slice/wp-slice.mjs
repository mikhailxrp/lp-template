// Нарезает статические HTML-страницы на template-parts по маркерам <!-- @wp: path.php --> ... <!-- /@wp: name -->.
// Ничего не меняет в проекте и в теме: пишет результат в папку --out (по умолчанию .wp-slices/).
// Запуск: node .claude/skills/wp-slice/wp-slice.mjs [project-dir] [--out dir]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outName = outIndex >= 0 ? args.splice(outIndex, 2)[1] : '.wp-slices';
const root = path.resolve(args[0] ?? '.');
const outDir = path.resolve(root, outName);

const stem = (name) => path.basename(name, '.php');
const normalize = (name = '') => stem(name.replace(/\(\)$/, ''));
const isPart = (name = '') => /\.php$/.test(name);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const parse = (html) => {
	const roots = [];
	const stack = [];
	const problems = [];
	for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
		const marker = m[1].trim().match(/^(\/)?@wp(-[a-z]+)?\s*:?\s*(\S*)/);
		if (!marker || marker[2]) continue; // @wp-repeat / @wp-loop остаются комментариями внутри куска
		const [, closing, , name] = marker;
		if (!closing) {
			const node = {
				name,
				key: normalize(name),
				openStart: m.index,
				innerStart: m.index + m[0].length,
				children: [],
			};
			(stack[stack.length - 1]?.children ?? roots).push(node);
			stack.push(node);
			continue;
		}
		const key = normalize(name);
		let position = -1;
		for (let i = stack.length - 1; i >= 0; i -= 1)
			if (stack[i].key === key) {
				position = i;
				break;
			}
		if (position < 0)
			for (let i = stack.length - 1; i >= 0; i -= 1)
				if (isPart(stack[i].name)) {
					position = i;
					break;
				}
		if (position < 0) {
			problems.push(
				`строка ${lineOf(html, m.index)}: закрывающий маркер без пары (${name})`,
			);
			continue;
		}
		const closed = stack.splice(position);
		closed.slice(1).forEach((n) => {
			if (isPart(n.name))
				problems.push(
					`строка ${lineOf(html, n.openStart)}: не закрыт ${n.name}`,
				);
		});
		closed[0].innerEnd = m.index;
		closed[0].closeEnd = m.index + m[0].length;
	}
	stack
		.filter((n) => isPart(n.name))
		.forEach((n) =>
			problems.push(`строка ${lineOf(html, n.openStart)}: не закрыт ${n.name}`),
		);
	return { roots, problems };
};

const dedent = (text) => {
	const lines = text
		.replace(/^(?:[ \t]*\n)+/, '')
		.replace(/\s+$/, '')
		.split('\n')
		.map((l) => l.replace(/[ \t]+$/, ''));
	const indents = lines
		.filter((l) => l.trim())
		.map((l) => l.match(/^\s*/)[0].length);
	const min = indents.length ? Math.min(...indents) : 0;
	return lines.map((l) => l.slice(min)).join('\n');
};

const partCall = (name) =>
	`<?php get_template_part( '${name.replace(/\.php$/, '')}' ); ?>`;

const render = (html, node) => {
	let result = '';
	let cursor = node.innerStart;
	const parts = collect(node.children);
	for (const child of parts) {
		result += html.slice(cursor, child.openStart);
		result += partCall(child.name);
		cursor = child.closeEnd;
	}
	result += html.slice(cursor, node.innerEnd);
	return dedent(result);
};

// непрозрачные маркеры (the_content() и т.п.) не становятся частями, но их дети могут
const collect = (nodes) =>
	nodes.flatMap((n) =>
		isPart(n.name) && n.closeEnd ? [n] : collect(n.children),
	);

const walk = (nodes) =>
	nodes.flatMap((n) => [
		...(isPart(n.name) && n.closeEnd ? [n] : []),
		...walk(n.children),
	]);

const pages = fs
	.readdirSync(root)
	.filter((f) => f.endsWith('.html'))
	.sort();
if (!pages.length) {
	console.error(`В ${root} нет .html файлов`);
	process.exit(2);
}

const slices = new Map(); // path -> { body, pages:Set }
const conflicts = [];
const report = [];
const assetRefs = new Map();

for (const page of pages) {
	const html = fs
		.readFileSync(path.join(root, page), 'utf8')
		.replace(/\r\n/g, '\n');
	const { roots, problems } = parse(html);
	problems.forEach((p) => report.push(`⚠ ${page}: ${p}`));
	for (const node of walk(roots)) {
		const body = render(html, node);
		const known = slices.get(node.name);
		if (!known)
			slices.set(node.name, {
				body,
				pages: new Set([page]),
				lines: body.split('\n').length,
			});
		else {
			known.pages.add(page);
			if (known.body !== body) {
				const a = known.body.split('\n');
				const b = body.split('\n');
				const i = a.findIndex((line, n) => line !== b[n]);
				conflicts.push(
					`${node.name} (${page}), 1-е отличие в строке ${i + 1}: «${(b[i] ?? '').trim().slice(0, 70)}» вместо «${(a[i] ?? '').trim().slice(0, 70)}»`,
				);
			}
		}
		for (const m of body.matchAll(
			/(?:src|href|srcset|poster)="(assets\/[^"]+)"/g,
		))
			assetRefs.set(m[1], (assetRefs.get(m[1]) ?? 0) + 1);
		for (const m of body.matchAll(/url\((['"]?)(assets\/[^)'"]+)\1\)/g))
			assetRefs.set(m[2], (assetRefs.get(m[2]) ?? 0) + 1);
	}
}

fs.rmSync(outDir, { recursive: true, force: true });
for (const [name, info] of slices) {
	const file = path.join(outDir, name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${info.body}\n`);
}

console.log(
	`Страниц: ${pages.length}. Кусков: ${slices.size}. Результат: ${path.relative(process.cwd(), outDir) || outDir}\n`,
);
console.table(
	[...slices].map(([name, info]) => ({
		part: name,
		строк: info.lines,
		страницы: [...info.pages].join(', '),
	})),
);
if (conflicts.length) {
	console.log(
		'\nОдна и та же часть, но разный HTML на страницах (взят первый, проверьте):',
	);
	conflicts.forEach((c) => console.log(`  - ${c}`));
}
if (report.length) {
	console.log('\nПроблемы с маркерами:');
	report.forEach((r) => console.log(`  ${r}`));
}
console.log(
	`\nПути assets/... внутри кусков: ${assetRefs.size} уникальных. В теме их надо заменить на get_stylesheet_directory_uri() . '/assets/...'.`,
);
console.log(
	'Поля (@wp-repeat, динамические вставки, the_content()) остаются комментариями: заменяются руками или через /wp-section-port.',
);
