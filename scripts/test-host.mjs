import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const install = process.env.DSH_INSTALL_ROOT;
if (!install) throw new Error('Set DSH_INSTALL_ROOT to the installed DeepSeek Harness directory. Run with its Electron in ELECTRON_RUN_AS_NODE mode.');
const moduleUrl = name => pathToFileURL(resolve(install, 'resources/app.asar/dsh/node_modules', name, 'lib/index.js')).href;
const { Context } = await import(moduleUrl('@deepseek-ai/cordis'));
const { ToolRuntime, assertSupportedJsonSchema } = await import(moduleUrl('@deepseek-ai/dsh-tools'));
const { SystemPrompt } = await import(moduleUrl('@deepseek-ai/dsh-system-prompt'));
const plugin = await import(process.env.DSH_TEST_PLUGIN ? pathToFileURL(resolve(process.env.DSH_TEST_PLUGIN)).href : '../lib/index.js');
const { parseMarketIndex, marketInstallTarget } = await import(moduleUrl('@deepseek-ai/dsh-plugin-market-index'));
const { marketIndex } = await import('./market-index.mjs');
const fixture = marketIndex({ name: 'dsh-free-search-lite', version: '0.1.0', description: 'TEST FIXTURE ONLY', author: 'Test fixture', repository: 'https://github.com/test-fixture/dsh-free-search-lite', engines: { dsh: '0.2.1-rc.3' } }, 1);
const index = parseMarketIndex(fixture, 'https://example.com/test-index.json');
assert.equal(marketInstallTarget(index.plugins[0].name, index.plugins[0].versions[0]).spec, 'dsh-free-search-lite@0.1.0');
console.log('Format-1 market index generator passed the actual DSH validator (in-memory test fixture only).');
const ctx = new Context();
new SystemPrompt(ctx, {});
new ToolRuntime(ctx, {});
const fiber = ctx.plugin(plugin);
await fiber.await();
try {
  const schemas = ctx.tools.schemas();
  assert.deepEqual(schemas.map(t => t.name).sort(), ['free_search', 'free_search_fetch']);
  for (const tool of schemas) assertSupportedJsonSchema(tool.parameters);
  const exec = (name, args) => ctx.tools.execute({ name, arguments: args, callId: `test-${name}`, signal: new AbortController().signal });
  const blocked = await exec('free_search_fetch', { url: 'http://127.0.0.1' });
  assert.equal(blocked.isError, true);
  const result = await exec('free_search', { query: 'DeepSeek Harness GitHub', count: 3 });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.ok(result.value.results.length > 0);
  assert.ok(result.content.some(c => c.type === 'text' && c.text.includes('https://')));
  const page = await exec('free_search_fetch', { url: 'https://nodejs.org/en/about', length: 1000, refresh: true });
  assert.equal(page.isError, false, JSON.stringify(page));
  assert.match(page.value.content, /Node\.js|JavaScript/);
  console.log(JSON.stringify({ runtime: 'installed dsh 0.2.1-rc.3', schemas: schemas.map(t => t.name), blockedPrivateUrl: blocked.isError, searchResults: result.value.results, page: { title: page.value.title, url: page.value.url, totalChars: page.value.totalChars }, integration: 'passed' }, null, 2));
} finally {
  await fiber.dispose();
  assert.equal(ctx.tools.schemas().length, 0);
  if (typeof ctx.stop === 'function') await ctx.stop();
  console.log('Plugin unload removed its tools. No profile, market or session was modified.');
}
