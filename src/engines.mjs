import { parseHTML, DOMParser } from 'linkedom';
import { publicUrl, SearchError } from './http.mjs';

import { sanitizeText } from './text.mjs';
const clean = value => sanitizeText(value ?? '').replace(/\s+/g, ' ').trim();
const text = node => clean(node?.textContent);

export function canonicalUrl(value, base) {
  try {
    let url = new URL(value, base);
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname.startsWith('/l/')) {
      url = new URL(url.searchParams.get('uddg') ?? '');
    } else if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname === '/ck/a') {
      const u = url.searchParams.get('u');
      if (u?.startsWith('a1')) url = new URL(Buffer.from(u.slice(2), 'base64url').toString('utf8'));
    }
    url = publicUrl(url.href);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}

export function parseResults(engine, html, base) {
  const document = engine === 'bing' ? new DOMParser().parseFromString(html, 'text/xml') : parseHTML(html).document;
  const candidates = [];
  if (engine === 'bing') {
    for (const item of document.querySelectorAll('item')) {
      candidates.push({ title: text(item.querySelector('title')), url: text(item.querySelector('link')), snippet: text(item.querySelector('description')) });
    }
  } else if (engine === 'so360') {
    for (const item of document.querySelectorAll('li.res-list')) {
      if (item.querySelector('[data-ad],.e_ad,.ad-label') || /\b(sponsored|result--ad)\b/.test(item.className)) continue;
      const a = item.querySelector('h3 a');
      candidates.push({ title: text(a), url: a?.getAttribute('data-mdurl') || a?.getAttribute('href'), snippet: text(item.querySelector('p.res-desc,div.res-comm-con')) });
    }
  } else if (engine === 'duckduckgo') {
    for (const item of document.querySelectorAll('div.result')) {
      if (/result--ad|result--sponsored/.test(item.className)) continue;
      const a = item.querySelector('a.result__a');
      const href = a?.getAttribute('href');
      if (!href || /duckduckgo\.com\/y\.js|ad_provider=/.test(href)) continue;
      candidates.push({ title: text(a), url: href, snippet: text(item.querySelector('.result__snippet')) });
    }
  }
  const seen = new Set();
  return candidates.flatMap(row => {
    const url = canonicalUrl(row.url, base);
    if (!row.title || !url || seen.has(url)) return [];
    if (/(^|\.)(so\.com|bing\.com|duckduckgo\.com)$/.test(new URL(url).hostname)) return [];
    seen.add(url);
    return [{ title: row.title.slice(0, 300), url, snippet: row.snippet.slice(0, 700), engine, rank: seen.size }];
  });
}

const stopwords = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'in', 'on', 'to', 'is', 'what', 'how', 'official', 'documentation', 'site', 'www', 'com', 'org', 'http', 'https']);
export function queryTerms(query) {
  const normalized = query.toLowerCase().replace(/(?:-?site|filetype):\S+/g, ' ');
  const ascii = (normalized.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []).filter(t => t.length > 1 && !stopwords.has(t));
  const cjk = (normalized.match(/[\u3400-\u9fff]+/g) ?? []).flatMap(run => run.length < 2 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)));
  return [...new Set([...ascii, ...cjk])];
}

export function relevance(query, result) {
  const terms = queryTerms(query);
  if (!terms.length) return 1;
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return terms.filter(term => haystack.includes(term)).length / terms.length;
}

export function mergeResults(query, rows, limit) {
  const merged = new Map();
  for (const row of rows) {
    const coverage = relevance(query, row);
    if (coverage < 0.2) continue;
    const key = row.url.replace(/^http:/, 'https:').replace(/\/$/, '');
    const existing = merged.get(key);
    const score = (1 + coverage) / (60 + row.rank);
    if (existing) {
      existing.score += score;
      if (!existing.sources.includes(row.engine)) existing.sources.push(row.engine);
      if (row.snippet.length > existing.snippet.length) existing.snippet = row.snippet;
    } else merged.set(key, { title: row.title, url: row.url, snippet: row.snippet, sources: [row.engine], score });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit).map(({ score, ...row }, i) => ({ rank: i + 1, ...row }));
}

export const engines = {
  so360: query => `https://www.so.com/s?q=${encodeURIComponent(query)}&rn=10&secure=1`,
  bing: query => `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
  duckduckgo: query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kp=-1`,
};

export async function runEngine(engine, query, http, signal) {
  const response = await http(engines[engine](query), { signal, timeoutMs: 9000 });
  if (/anomaly\.js|id=["']challenge-form|unusual traffic|automated queries|请完成.{0,8}验证|验证码.{0,15}(校验|验证)/i.test(response.text)) {
    throw new SearchError('blocked', '搜索引擎要求验证或限制自动访问，未尝试绕过。');
  }
  const rows = parseResults(engine, response.text, response.url);
  const relevant = rows.filter(row => relevance(query, row) >= 0.2);
  return {
    rows: relevant,
    status: { engine, status: relevant.length ? 'ok' : rows.length ? 'irrelevant' : 'empty', results: relevant.length,
      ...(relevant.length ? {} : { message: rows.length ? '结果与查询明显不相关，已丢弃。' : '未解析到自然搜索结果；可能无匹配、页面变化或访问受限。' }) },
  };
}
