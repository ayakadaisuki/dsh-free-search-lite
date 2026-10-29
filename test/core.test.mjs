import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, publicUrl, resolvePublic, cappedText, createHttp, SearchError } from '../src/http.mjs';
import { parseResults, canonicalUrl, mergeResults, relevance } from '../src/engines.mjs';
import { createSearchService, TtlCache, extractPage } from '../src/service.mjs';
import { toolDefinitions, apply } from '../src/index.mjs';

for (const address of ['127.0.0.1', '10.2.3.4', '192.168.1.1', '169.254.169.254', '172.16.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) {
  test(`blocks nonpublic IP ${address}`, () => assert.equal(publicAddress(address), false));
}
test('allows public IPv4 and IPv6', () => { assert.ok(publicAddress('8.8.8.8')); assert.ok(publicAddress('2606:4700:4700::1111')); });
for (const url of ['file:///etc/passwd', 'https://localhost', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://metadata.internal/', 'https://user:pass@example.com/', 'https://example.com:8080/', 'https://printer/', 'ftp://example.com']) {
  test(`rejects unsafe URL ${url}`, () => assert.throws(() => publicUrl(url), SearchError));
}
test('DNS rejects mixed private and public addresses', async () => {
  await assert.rejects(resolvePublic(new URL('https://example.com'), async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /非公网/);
});
test('redirect validates target before fetching it', async () => {
  let calls = 0;
  const request = createHttp({ resolver: async () => [{ address: '8.8.8.8', family: 4 }], agentFactory: () => ({ destroy: async () => {} }), fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }); } });
  await assert.rejects(request('https://example.com'), SearchError);
  assert.equal(calls, 1);
});
test('connection resolver pins only validated DNS results', async () => {
  let options;
  const request = createHttp({ resolver: async () => [{ address: '8.8.8.8', family: 4 }], agentFactory: opts => { options = opts; return { destroy: async () => {} }; }, fetchImpl: async () => new Response('hello', { headers: { 'content-type': 'text/plain' } }) });
  await request('https://example.com');
  options.connect.lookup('example.com', { all: true }, (error, values) => { assert.equal(error, null); assert.deepEqual(values, [{ address: '8.8.8.8', family: 4 }]); });
});
test('limits redirect count', async () => {
  let calls = 0;
  const request = createHttp({ resolver: async () => [{ address: '8.8.8.8', family: 4 }], agentFactory: () => ({ destroy: async () => {} }), fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/loop' } }); } });
  await assert.rejects(request('https://example.com'), /重定向/); assert.equal(calls, 6);
});
test('blocks unsupported documents and rate limits without reading body', async () => {
  for (const response of [new Response('pdf', { headers: { 'content-type': 'application/pdf' } }), new Response('slow down', { status: 429 })]) {
    const request = createHttp({ resolver: async () => [{ address: '8.8.8.8', family: 4 }], agentFactory: () => ({ destroy: async () => {} }), fetchImpl: async () => response });
    await assert.rejects(request('https://example.com'), SearchError);
  }
});
test('caps streamed bytes and declared size', async () => {
  await assert.rejects(cappedText(new Response('abcdef'), 3), /超过/);
  await assert.rejects(cappedText(new Response('a', { headers: { 'content-length': '5000' } }), 3), /超过/);
});
test('decodes legacy Chinese encoding', async () => {
  const result = await cappedText(new Response(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), { headers: { 'content-type': 'text/html; charset=gbk' } }), 100);
  assert.equal(result, '中文');
});
test('DDG unwrapping happens once and ads are excluded', () => {
  const target = 'https://example.com/wiki/C%2B%2B';
  const html = `<div class="result result--ad"><a class="result__a" href="https://ads.example.com">Ad</a></div><div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">C++</a><p class="result__snippet">Language</p></div>`;
  const rows = parseResults('duckduckgo', html, 'https://html.duckduckgo.com');
  assert.equal(rows.length, 1); assert.equal(rows[0].url, target);
});
test('360 reads canonical targets and strips markup', () => {
  const rows = parseResults('so360', '<li class="res-list"><h3><a href="https://www.so.com/link" data-mdurl="https://example.com/a">官方<b>文档</b></a></h3><p class="res-desc">正文</p></li>', 'https://www.so.com');
  assert.equal(rows[0].url, 'https://example.com/a'); assert.equal(rows[0].title, '官方文档');
});
test('Bing RSS extracts natural results', () => {
  const rows = parseResults('bing', '<?xml version="1.0"?><rss><channel><item><title>Node.js &amp; docs</title><link>https://nodejs.org/docs/</link><description>JavaScript</description></item></channel></rss>', 'https://www.bing.com');
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Node.js & docs');
});
test('normalizes tracking URLs without removing meaningful query fields', () => {
  assert.equal(canonicalUrl('https://example.com/a?q=C%2B%2B&utm_source=x#top'), 'https://example.com/a?q=C%2B%2B');
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
});
test('drops obvious decoy results and merges duplicate sources', () => {
  const row = { title: 'Node.js documentation', url: 'https://nodejs.org/', snippet: '', engine: 'bing', rank: 1 };
  assert.equal(relevance('Node.js official documentation', { title: '芒果电视', snippet: '', url: 'https://example.com' }), 0);
  const result = mergeResults('Node.js official documentation', [row, { ...row, engine: 'so360' }, { ...row, title: '芒果电视', url: 'https://example.com/' }], 5);
  assert.equal(result.length, 1); assert.deepEqual(result[0].sources, ['bing', 'so360']);
});
test('TTL cache expires, evicts and clones values', () => {
  let time = 0; const cache = new TtlCache(1, 10, () => time);
  cache.set('a', { v: 1 }); const a = cache.get('a'); a.v = 2; assert.equal(cache.get('a').v, 1);
  cache.set('b', 2); assert.equal(cache.get('a'), undefined); time = 11; assert.equal(cache.get('b'), undefined);
});
test('search falls back and does not cache failures', async () => {
  let calls = 0;
  const service = createSearchService({ engineRunner: async engine => { calls++; if (engine !== 'duckduckgo') throw new Error('network'); return { rows: [{ title: 'test result', url: 'https://example.com/', snippet: 'test', engine, rank: 1 }], status: { engine, status: 'ok' } }; } });
  try {
    const value = await service.search({ query: 'test' }); assert.equal(value.results.length, 1); assert.equal(calls, 3);
    const cached = await service.search({ query: 'test' }); assert.equal(cached.cached, true); assert.equal(calls, 3);
  } finally { await service.dispose(); }
});
test('all engines failed is a diagnostic result, never a fabricated answer', async () => {
  let calls = 0; const service = createSearchService({ engineRunner: async () => { calls++; throw new Error('failure'); } });
  try { const result = await service.search({ query: 'test' }); assert.deepEqual(result.results, []); assert.equal(result.engines.length, 3); await service.search({ query: 'test' }); assert.equal(calls, 6); } finally { await service.dispose(); }
});
test('web extraction removes scripts, does not execute HTML', () => {
  const page = extractPage({ url: 'https://example.com', contentType: 'text/html', text: '<html><head><title>Example</title></head><body><main><h1>Hello</h1><p>Readable content</p><script>throw new Error("executed")</script></main></body></html>' });
  assert.match(page.text, /Readable content/); assert.doesNotMatch(page.text, /executed/);
});
test('fetch paging has explicit continuation and uses bounded cache', async () => {
  let calls = 0; const service = createSearchService({ http: async url => { calls++; return { url, text: 'A'.repeat(2500), contentType: 'text/plain' }; } });
  try { const first = await service.fetchPage({ url: 'https://example.com', length: 1000 }); assert.equal(first.nextStart, 1000); const last = await service.fetchPage({ url: 'https://example.com', start: 2000, length: 1000 }); assert.equal(last.nextStart, null); assert.equal(last.content.length, 500); assert.equal(calls, 1); } finally { await service.dispose(); }
});
test('invalid arguments and cancellation fail before network', async () => {
  const service = createSearchService({ http: async () => { throw new Error('must not call'); } });
  try {
    await assert.rejects(service.search({ query: '  ' }), /query/);
    await assert.rejects(service.search({ query: 'test', count: 100 }), /count/);
    await assert.rejects(service.fetchPage({ url: 'http://localhost' }), SearchError);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.search({ query: 'test' }, controller.signal), /abort/i);
  } finally { await service.dispose(); }
});
test('article extraction preserves code identifiers and indentation', () => {
  const code = 'if (ready) {\n  const hostname = "127.0.0.1";\n  return hostname;\n}';
  const page = extractPage({ url: 'https://example.com', contentType: 'text/html', text: `<html><head><title>Code</title></head><body><main><p>${'Useful documentation. '.repeat(20)}</p><pre><code>${code}</code></pre></main></body></html>` });
  assert.ok(page.text.includes(code));
});
test('refresh bypasses cached pages', async () => {
  let calls = 0; const service = createSearchService({ http: async url => ({ url, contentType: 'text/plain', text: `revision ${++calls}` }) });
  try { await service.fetchPage({ url: 'https://example.com' }); const refreshed = await service.fetchPage({ url: 'https://example.com', refresh: true }); assert.equal(calls, 2); assert.equal(refreshed.cached, false); } finally { await service.dispose(); }
});
test('concurrency limit rejects excess requests and unload cancels running ones', async () => {
  const service = createSearchService({ engineRunner: async (_name, _query, _http, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const running = Array.from({ length: 4 }, (_, i) => service.search({ query: `test ${i}` }).catch(e => e));
  await assert.rejects(service.search({ query: 'fifth' }), /4 个请求/);
  await service.dispose(); await Promise.all(running);
});
test('removes invisible output controls', () => {
  const page = extractPage({ url: 'https://example.com', contentType: 'text/plain', text: 'good\u001b\u202eevil' });
  assert.equal(page.text, 'goodevil');
});
test('plugin mounts exactly two tools and cleans up its effects', async () => {
  const mounted = new Map(); let generator;
  const ctx = { tools: { register(definition) { assert.ok(!mounted.has(definition.name)); mounted.set(definition.name, definition); return () => mounted.delete(definition.name); } }, systemPrompt: { section: () => () => {} }, effect(fn) { generator = fn(); for (let item = generator.next(); !item.done; item = generator.next()) this.disposers.push(item.value); }, disposers: [] };
  apply(ctx);
  assert.deepEqual([...mounted.keys()], ['free_search', 'free_search_fetch']);
  assert.deepEqual(toolDefinitions({})[0].output.render({}, { results: [] }), [{ type: 'text', text: '{\n  "results": []\n}' }]);
  for (const dispose of ctx.disposers.reverse()) if (typeof dispose === 'function') await dispose();
  assert.equal(mounted.size, 0);
});
