import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function marketIndex(pkg, publishTimestamp) {
  if (!Number.isInteger(publishTimestamp) || publishTimestamp <= 0) throw new Error('Supply the actual npm publication time in Unix seconds.');
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!author?.trim() || !repository) throw new Error('Set the actual author and repository in package.json before generating a public index.');
  const url = new URL(repository.replace(/^git\+/, '').replace(/\.git$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.endsWith('.invalid') || /example\.com$/.test(url.hostname)) throw new Error('A real public HTTPS repository is required.');
  return {
    format: 1,
    title: { en: 'Free Search Lite', zh: '轻量免费搜索' },
    description: { en: 'Public web search without browser dependencies.', zh: '无需浏览器的公网搜索插件。' },
    plugins: [{
      name: pkg.name, title: { en: 'Free Search Lite', zh: '轻量免费搜索' },
      description: { en: pkg.description, zh: '免 API Key 的中英文联网搜索与网页正文读取。无需浏览器、Python 或额外配置。' },
      author, repository: { url: url.href }, homepage: pkg.homepage || url.href,
      metadata: { keywords: ['search', 'web', '搜索', '免费', 'zero-config'] },
      versions: [{ version: pkg.version, publishTimestamp, source: { type: 'npm', registry: 'https://registry.npmjs.org/' }, engines: { dsh: pkg.engines.dsh } }],
    }],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const timestamp = Number(process.argv[process.argv.indexOf('--published-at') + 1]);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const index = marketIndex(pkg, timestamp);
  await mkdir(resolve(root, 'releases'), { recursive: true });
  await writeFile(resolve(root, 'releases/index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log('Generated releases/index.json. Host it only after verifying npm publication.');
}
