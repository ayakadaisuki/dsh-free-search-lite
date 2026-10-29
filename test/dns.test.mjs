import test from 'node:test';
import assert from 'node:assert/strict';
import { createDohResolver, createTunResolver, createHttp, publicAddress, publicUrl, resolvePublic, SearchError } from '../src/http.mjs';

const dnsResponse = (answers, { status = 0, headers = {} } = {}) => new Response(JSON.stringify({ Status: status, Answer: answers }), { headers: { 'content-type': 'application/dns-json', ...headers } });
const A = data => ({ type: 1, data });
const AAAA = data => ({ type: 28, data });
const CNAME = data => ({ type: 5, data });
const inspect = input => {
  const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input));
  return { host: url.hostname, path: url.pathname, name: url.searchParams.get('name'), type: (url.searchParams.get('type') ?? '').toUpperCase() };
};

function mockDoh(handler) {
  const calls = [], agents = [];
  const fetchImpl = async (input, options = {}) => {
    const info = inspect(input);
    calls.push({ ...info, options });
    return handler(info, options);
  };
  const agentFactory = options => { agents.push(options); return { destroy: async () => {} }; };
  return { fetchImpl, agentFactory, calls, agents, create: () => createDohResolver({ fetchImpl, agentFactory }) };
}

async function pinnedAddresses(agents) {
  const pinned = new Set();
  for (const options of agents) {
    for (const host of ['cloudflare-dns.com', 'dns.google']) {
      const values = await new Promise(resolve => {
        try { options.connect.lookup(host, { all: true }, (error, list) => resolve(error ? [] : list)); } catch { resolve([]); }
      });
      for (const value of values) pinned.add(`${value.address}/${value.family}`);
    }
  }
  return pinned;
}

test('fake DNS ranges remain non-public and are rejected by publicUrl', () => {
  for (const address of ['198.18.0.1', '198.19.255.254', 'fdfe:dcba:9876::1', '::ffff:198.18.0.1']) {
    assert.equal(publicAddress(address), false, address);
    assert.throws(() => publicUrl(`http://${address.includes(':') ? `[${address}]` : address}/`), SearchError, address);
  }
});

test('DoH queries A and AAAA in parallel on the fixed first provider without following redirects', async () => {
  const calls = [], agents = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = async (input, options = {}) => {
    const info = inspect(input);
    calls.push({ ...info, options });
    await gate;
    return info.type === 'A' ? dnsResponse([A('93.184.216.34')]) : dnsResponse([AAAA('2606:2800:220:1:248:1893:25c8:1946')]);
  };
  const agentFactory = options => { agents.push(options); return { destroy: async () => {} }; };
  const pending = createDohResolver({ fetchImpl, agentFactory })('example.com');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 2, 'A and AAAA must be in flight together');
  release();
  const addresses = await pending;
  assert.ok(calls.every(call => call.host === 'cloudflare-dns.com' && call.path === '/dns-query' && call.name === 'example.com'));
  assert.deepEqual(new Set(calls.map(call => call.type)), new Set(['A', 'AAAA']));
  assert.ok(calls.every(call => ['manual', 'error'].includes(call.options.redirect)));
  assert.deepEqual(new Set(addresses.map(value => `${value.address}/${value.family}`)), new Set(['93.184.216.34/4', '2606:2800:220:1:248:1893:25c8:1946/6']));
  assert.ok((await pinnedAddresses(agents)).has('1.1.1.1/4'));
});

test('DoH accepts public A and AAAA answers and ignores unrelated record types', async () => {
  const mock = mockDoh(({ type }) => type === 'A'
    ? dnsResponse([CNAME('alias.example.'), A('93.184.216.34')])
    : dnsResponse([CNAME('alias.example.'), AAAA('2606:2800:220:1:248:1893:25c8:1946')]));
  const addresses = await mock.create()('example.com');
  assert.deepEqual(new Set(addresses.map(value => `${value.address}/${value.family}`)), new Set(['93.184.216.34/4', '2606:2800:220:1:248:1893:25c8:1946/6']));
  assert.ok(mock.calls.every(call => call.host === 'cloudflare-dns.com'));
});

test('DoH permits one empty family and reports dns_error only when both are empty', async () => {
  const v4 = mockDoh(({ type }) => type === 'A' ? dnsResponse([A('93.184.216.34')]) : dnsResponse(undefined));
  assert.deepEqual(await v4.create()('example.com'), [{ address: '93.184.216.34', family: 4 }]);
  assert.ok(v4.calls.every(call => call.host === 'cloudflare-dns.com'));

  const v6 = mockDoh(({ type }) => type === 'AAAA' ? dnsResponse([AAAA('2606:4700:4700::1111')]) : dnsResponse(undefined));
  assert.deepEqual(await v6.create()('example.com'), [{ address: '2606:4700:4700::1111', family: 6 }]);

  const none = mockDoh(() => dnsResponse([]));
  await assert.rejects(none.create()('example.com'), error => error instanceof SearchError && error.code === 'dns_error');
});

test('DoH treats NXDOMAIN as a terminal dns_error without trying the second provider', async () => {
  const mock = mockDoh(() => dnsResponse([], { status: 3 }));
  await assert.rejects(mock.create()('example.com'), error => error instanceof SearchError && error.code === 'dns_error');
  assert.ok(mock.calls.length >= 1);
  assert.ok(mock.calls.every(call => call.host === 'cloudflare-dns.com'));
});

test('DoH fails over to dns.google on bad status, redirects, HTTP errors and network failures', async () => {
  const failures = [
    () => new Response('server error', { status: 500 }),
    () => new Response('redirect', { status: 302, headers: { location: 'https://example.com/' } }),
    () => dnsResponse([], { status: 2 }),
    () => new Response(JSON.stringify({ Answer: [A('93.184.216.34')] }), { headers: { 'content-type': 'application/dns-json' } }),
    () => { throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }); },
  ];
  for (const failure of failures) {
    const mock = mockDoh(({ host, type }) => host === 'cloudflare-dns.com'
      ? failure()
      : type === 'A' ? dnsResponse([A('93.184.216.34')]) : dnsResponse([]));
    assert.deepEqual(await mock.create()('example.com'), [{ address: '93.184.216.34', family: 4 }]);
    assert.ok(mock.calls.some(call => call.host === 'dns.google' && call.path === '/resolve'));
    const pinned = await pinnedAddresses(mock.agents);
    assert.ok(pinned.has('1.1.1.1/4'));
    assert.ok(pinned.has('8.8.8.8/4'));
  }
});

test('DoH blocks private and fake answers without retrying the second provider', async () => {
  for (const address of ['10.0.0.5', '198.18.0.9', 'fdfe:dcba:9876::9', '::ffff:198.18.0.9']) {
    const family = address.includes(':') ? 'AAAA' : 'A';
    const mock = mockDoh(({ type }) => type === family
      ? dnsResponse([family === 'A' ? A(address) : AAAA(address)])
      : dnsResponse([]));
    await assert.rejects(mock.create()('example.com'), error => error instanceof SearchError && error.code === 'blocked_address', address);
    assert.ok(mock.calls.every(call => call.host === 'cloudflare-dns.com'), address);
  }
});

test('DoH ignores answers whose record type or address family does not match the query', async () => {
  const mock = mockDoh(({ type }) => type === 'A'
    ? dnsResponse([AAAA('2606:4700:4700::1111'), A('2001:4860::8888'), { type: 1, data: 'not-an-ip' }])
    : dnsResponse([A('93.184.216.34'), AAAA('not-an-ip')]));
  await assert.rejects(mock.create()('example.com'), error => error instanceof SearchError && error.code === 'dns_error');
});

test('DoH rejects oversized DNS responses', { timeout: 5000 }, async () => {
  const huge = JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34', padding: 'x'.repeat(70 * 1024) }] });
  const mock = mockDoh(() => new Response(huge, { headers: { 'content-type': 'application/dns-json', 'content-length': String(huge.length) } }));
  await assert.rejects(mock.create()('example.com'), error => error instanceof SearchError);
});

test('DoH cancellation reaches the provider fetches', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const signals = [];
  const fetchImpl = (_input, options = {}) => new Promise((_resolve, reject) => {
    signals.push(options.signal);
    if (!options.signal) return reject(new Error('DoH fetch received no signal'));
    if (options.signal.aborted) return reject(options.signal.reason);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const pending = createDohResolver({ fetchImpl, agentFactory: () => ({ destroy: async () => {} }) })('example.com', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(signals.length >= 1);
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, error => error?.name === 'AbortError' || error?.code === 'dns_error');
  assert.ok(signals.every(signal => signal?.aborted));
});

test('TUN resolver leaves normal public system answers unchanged', async () => {
  let dohCalls = 0;
  const resolver = createTunResolver({ resolver: async () => [{ address: '93.184.216.34', family: 4 }], dohResolver: async () => { dohCalls++; return []; } });
  assert.deepEqual(await resolver('example.com', { all: true }), [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(dohCalls, 0);
});

test('TUN resolver leaves private-only system answers for resolvePublic to reject', async () => {
  let dohCalls = 0;
  const resolver = createTunResolver({ resolver: async () => [{ address: '10.0.0.7', family: 4 }], dohResolver: async () => { dohCalls++; return [{ address: '93.184.216.34', family: 4 }]; } });
  assert.deepEqual(await resolver('example.com'), [{ address: '10.0.0.7', family: 4 }]);
  await assert.rejects(resolvePublic(new URL('https://example.com'), resolver), error => error instanceof SearchError && error.code === 'blocked_address');
  assert.equal(dohCalls, 0);
});

for (const [label, systemAddress, family, dohAddress, dohFamily] of [
  ['IPv4', '198.18.0.1', 4, '93.184.216.34', 4],
  ['IPv6', 'fdfe:dcba:9876::1', 6, '2606:4700:4700::1111', 6],
  ['mapped IPv4', '::ffff:198.18.0.1', 6, '2606:4700:4700::1111', 6],
]) {
  test(`TUN resolver falls back to DoH for fake ${label}`, async () => {
    let dohCalls = 0;
    const resolver = createTunResolver({
      resolver: async () => [{ address: systemAddress, family }],
      dohResolver: async host => { dohCalls++; assert.equal(host, 'example.com'); return [{ address: dohAddress, family: dohFamily }]; },
    });
    assert.deepEqual(await resolver('example.com'), [{ address: dohAddress, family: dohFamily }]);
    assert.equal(dohCalls, 1);
  });
}

test('TUN resolver uses DoH when a fake address is mixed with public answers', async () => {
  const resolver = createTunResolver({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '198.18.0.1', family: 4 }],
    dohResolver: async () => [{ address: '1.0.0.1', family: 4 }],
  });
  assert.deepEqual(await resolver('example.com'), [{ address: '1.0.0.1', family: 4 }]);
});

test('TUN resolver blocks fake addresses mixed with other non-public answers instead of falling back', async () => {
  let dohCalls = 0;
  const resolver = createTunResolver({
    resolver: async () => [{ address: '198.18.0.1', family: 4 }, { address: '10.0.0.7', family: 4 }],
    dohResolver: async () => { dohCalls++; return [{ address: '93.184.216.34', family: 4 }]; },
  });
  await assert.rejects(resolver('example.com'), error => error instanceof SearchError && error.code === 'blocked_address');
  assert.equal(dohCalls, 0);
});

test('TUN resolver propagates system DNS failures without trying DoH', async () => {
  let dohCalls = 0;
  const resolver = createTunResolver({
    resolver: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); },
    dohResolver: async () => { dohCalls++; return [{ address: '93.184.216.34', family: 4 }]; },
  });
  await assert.rejects(resolver('example.com'), error => error.code === 'ENOTFOUND');
  assert.equal(dohCalls, 0);
});

test('DoH answers still pass through resolvePublic validation', async () => {
  let fetches = 0;
  const resolver = createTunResolver({ resolver: async () => [{ address: '198.18.0.1', family: 4 }], dohResolver: async () => [{ address: '10.0.0.9', family: 4 }] });
  await assert.rejects(resolvePublic(new URL('https://example.com'), resolver), error => error instanceof SearchError && error.code === 'blocked_address');
  const request = createHttp({ resolver, agentFactory: () => ({ destroy: async () => {} }), fetchImpl: async () => { fetches++; return new Response('unexpected'); } });
  await assert.rejects(request('https://example.com'), error => error instanceof SearchError && error.code === 'blocked_address');
  assert.equal(fetches, 0);
});

test('createHttp pins the DoH-resolved target address for the actual connection', async () => {
  let connection;
  const doh = createDohResolver({
    fetchImpl: async input => inspect(input).type === 'A' ? dnsResponse([A('93.184.216.34')]) : dnsResponse([AAAA('2606:2800:220:1:248:1893:25c8:1946')]),
    agentFactory: () => ({ destroy: async () => {} }),
  });
  const request = createHttp({
    resolver: createTunResolver({ resolver: async () => [{ address: '198.18.0.1', family: 4 }], dohResolver: doh }),
    agentFactory: options => { connection = options; return { destroy: async () => {} }; },
    fetchImpl: async () => new Response('hello', { headers: { 'content-type': 'text/plain' } }),
  });
  assert.equal((await request('https://example.com')).text, 'hello');
  const pinned = await new Promise(resolve => connection.connect.lookup('example.com', { all: true }, (error, values) => resolve(error ? [] : values)));
  assert.deepEqual(new Set(pinned.map(value => `${value.address}/${value.family}`)), new Set(['93.184.216.34/4', '2606:2800:220:1:248:1893:25c8:1946/6']));
});

test('private redirect targets are rejected before a second fetch', async () => {
  let fetches = 0;
  const request = createHttp({
    resolver: createTunResolver({ resolver: async () => [{ address: '93.184.216.34', family: 4 }], dohResolver: async () => { throw new Error('DoH must not run'); } }),
    agentFactory: () => ({ destroy: async () => {} }),
    fetchImpl: async () => { fetches++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }); },
  });
  await assert.rejects(request('https://example.com'), error => error instanceof SearchError && error.code === 'blocked_url');
  assert.equal(fetches, 1);
});

test('createHttp leaves an explicit custom resolver untouched', async () => {
  let fetches = 0;
  const request = createHttp({
    resolver: async () => [{ address: '198.18.0.1', family: 4 }],
    agentFactory: () => ({ destroy: async () => {} }),
    fetchImpl: async () => { fetches++; return new Response('x', { headers: { 'content-type': 'text/plain' } }); },
  });
  await assert.rejects(request('https://example.com'), error => error instanceof SearchError && error.code === 'blocked_address');
  assert.equal(fetches, 0);
});

test('resolvePublic forwards the abort signal to the resolver', async () => {
  const controller = new AbortController();
  let seen;
  const addresses = await resolvePublic(new URL('https://example.com'), async (_host, options) => {
    seen = options;
    return [{ address: '93.184.216.34', family: 4 }];
  }, controller.signal);
  assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(seen.signal, controller.signal);
});
