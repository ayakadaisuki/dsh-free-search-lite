import { createSearchService } from '../src/service.mjs';
const service = createSearchService();
try {
  for (const query of ['Node.js official documentation', '中华人民共和国 民法典 中国人大网']) {
    const result = await service.search({ query, count: 5 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.results.length) throw new Error(`No live results for ${query}`);
    if (query.startsWith('Node') && !result.results.some(r => r.url.includes('nodejs.org'))) throw new Error('Node.js official source absent');
    if (query.startsWith('中华') && !result.results.some(r => /民法典/.test(r.title + r.snippet))) throw new Error('Chinese results are irrelevant');
  }
  const page = await service.fetchPage({ url: 'https://nodejs.org/en/about', length: 3000 });
  console.log(JSON.stringify(page, null, 2));
  if (!/JavaScript|Node\.js/.test(page.content)) throw new Error('Source page not extracted');
} finally { await service.dispose(); }
