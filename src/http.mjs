import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

export function publicAddress(address) {
  try {
    const ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) return publicAddress(ip.toIPv4Address().toString());
    return ip.range() === 'unicast';
  } catch { return false; }
}

export function publicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new SearchError('invalid_url', '需要完整的 http:// 或 https:// 公网网址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new SearchError('blocked_url', '仅允许不含用户名和密码的 HTTP(S) 公网网址。');
  }
  if (url.port && !['80', '443'].includes(url.port)) throw new SearchError('blocked_url', '仅允许标准 HTTP/HTTPS 端口。');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') && !isIP(host) || /(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) {
    throw new SearchError('blocked_url', '不访问本机、局域网或内部域名。');
  }
  if (isIP(host) && !publicAddress(host)) throw new SearchError('blocked_url', '不访问本机、局域网、链路本地或保留地址。');
  url.hash = '';
  return url;
}

const fakeIpRanges = ['198.18.0.0/15', 'fdfe:dcba:9876::/64'].map(value => ipaddr.parseCIDR(value));
const dohProviders = [
  { url: 'https://cloudflare-dns.com/dns-query', address: '1.1.1.1' },
  { url: 'https://dns.google/resolve', address: '8.8.8.8' },
];

function fakeAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return fakeIpRanges.some(([network, prefix]) => ip.kind() === network.kind() && ip.match(network, prefix));
  } catch { return false; }
}

export function createDohResolver({ fetchImpl = fetch, agentFactory = options => new Agent(options), timeoutMs = 3000 } = {}) {
  return async function resolve(host, { signal } = {}) {
    signal?.throwIfAborted();
    let lastError;
    for (const provider of dohProviders) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      // Bootstrap fixed DNS providers without asking the fake-IP system resolver.
      const dispatcher = agentFactory({ connect: { lookup(_host, options, callback) {
        if (options.family && options.family !== 4) return callback(new Error('DNS bootstrap requires IPv4'));
        if (options.all) callback(null, [{ address: provider.address, family: 4 }]);
        else callback(null, provider.address, 4);
      } } });
      try {
        const outcomes = await Promise.allSettled([1, 28].map(async type => {
          const url = new URL(provider.url);
          url.searchParams.set('name', host);
          url.searchParams.set('type', type === 1 ? 'A' : 'AAAA');
          const response = await fetchImpl(url.href, { dispatcher, signal: combined, redirect: 'error', headers: { accept: 'application/dns-json' } });
          if (!response.ok) {
            await response.body?.cancel();
            throw new SearchError('dns_error', `加密 DNS 返回 HTTP ${response.status}。`);
          }
          const data = JSON.parse(await cappedText(response, 64 * 1024));
          if (data.Status !== 0 || data.Answer !== undefined && !Array.isArray(data.Answer)) {
            const error = new SearchError('dns_error', '加密 DNS 未返回有效解析结果。');
            if (data.Status === 3) error.retryable = false;
            throw error;
          }
          const addresses = (data.Answer ?? []).filter(answer => answer.type === type).map(answer => ({ address: answer.data, family: type === 1 ? 4 : 6 }));
          if (addresses.some(({ address, family }) => typeof address !== 'string' || isIP(address) !== family)) {
            throw new SearchError('dns_error', '加密 DNS 返回了无效地址。');
          }
          if (addresses.some(({ address }) => !publicAddress(address))) throw new SearchError('blocked_address', '加密 DNS 解析到非公网地址，已停止访问。');
          return addresses;
        }));
        signal?.throwIfAborted();
        const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
        const terminal = errors.find(error => ['blocked_address', 'too_large'].includes(error?.code) || error?.retryable === false);
        if (terminal) throw terminal;
        if (errors.length) throw errors[0];
        const addresses = outcomes.flatMap(outcome => outcome.value);
        if (!addresses.length) throw new SearchError('dns_error', '加密 DNS 没有返回 A 或 AAAA 地址。');
        return addresses.filter((value, index) => addresses.findIndex(other => other.address === value.address) === index);
      } catch (error) {
        signal?.throwIfAborted();
        if (['blocked_address', 'too_large'].includes(error?.code) || error?.retryable === false) throw error;
        lastError = error;
      } finally { await dispatcher.destroy(); }
    }
    throw new SearchError('dns_error', `无法通过加密 DNS 获取真实公网地址（${lastError?.code ?? lastError?.name ?? 'Error'}）；未放行 fake-IP 或内网地址。`);
  };
}

export function createTunResolver({ resolver = lookup, dohResolver = createDohResolver() } = {}) {
  return async function resolve(host, options = {}) {
    options.signal?.throwIfAborted();
    const addresses = await resolver(host, options);
    options.signal?.throwIfAborted();
    if (!addresses.some(({ address }) => fakeAddress(address))) return addresses;
    if (addresses.some(({ address }) => !publicAddress(address) && !fakeAddress(address))) {
      throw new SearchError('blocked_address', '该域名同时解析到内网地址，已停止访问。');
    }
    const resolved = await dohResolver(host, options);
    options.signal?.throwIfAborted();
    if (!resolved.length || resolved.some(({ address }) => !publicAddress(address))) {
      throw new SearchError('blocked_address', '该域名解析到非公网地址，已停止访问。');
    }
    return resolved;
  };
}

export async function resolvePublic(url, resolver = lookup, signal) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host, { all: true, verbatim: true, signal });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new SearchError('blocked_address', '该域名解析到非公网地址，已停止访问。');
  }
  return addresses;
}

export async function cappedText(response, maxBytes) {
  const size = Number(response.headers.get('content-length'));
  if (size > maxBytes) {
    await response.body?.cancel();
    throw new SearchError('too_large', '页面超过 2 MB，未下载完整内容。');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new SearchError('too_large', '解压后的页面超过 2 MB，已停止读取。');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const data = Buffer.concat(chunks, bytes);
  const type = response.headers.get('content-type') ?? '';
  const declared = type.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  const meta = data.subarray(0, 4096).toString('latin1').match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1];
  let decoder;
  try { decoder = new TextDecoder(declared ?? meta ?? 'utf-8'); } catch { decoder = new TextDecoder('utf-8'); }
  return decoder.decode(data);
}

export function createHttp({ resolver = createTunResolver(), fetchImpl = fetch, agentFactory = (options) => new Agent(options) } = {}) {
  return async function request(input, { signal, timeoutMs = 12000, maxBytes = 2 * 1024 * 1024 } = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let url = publicUrl(input);
    for (let redirects = 0; redirects <= 5; redirects++) {
      combined.throwIfAborted();
      let onAbort;
      let addresses;
      try {
        addresses = await Promise.race([
          resolvePublic(url, resolver, combined),
          new Promise((_, reject) => {
            onAbort = () => reject(combined.reason);
            if (combined.aborted) return onAbort();
            combined.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } finally { if (onAbort) combined.removeEventListener('abort', onAbort); }
      combined.throwIfAborted();
      // Pin the validated addresses so connection-time DNS cannot rebind to a private host.
      const dispatcher = agentFactory({ connect: { lookup(_host, options, callback) {
        const compatible = addresses.filter(a => !options.family || a.family === options.family);
        if (!compatible.length) return callback(new Error('No validated address for requested family'));
        if (options.all) callback(null, compatible);
        else callback(null, compatible[0].address, compatible[0].family);
      } } });
      try {
        const response = await fetchImpl(url.href, {
          dispatcher, signal: combined, redirect: 'manual',
          headers: { 'user-agent': 'DshFreeSearch/0.1 (+public-web-search; no-browser)', accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml,text/plain,application/json;q=0.8', 'accept-language': 'zh-CN,zh;q=0.8,en;q=0.7' },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || redirects === 5) throw new SearchError('redirect_limit', '页面重定向过多或缺少目标网址。');
          url = publicUrl(new URL(location, url).href);
          continue;
        }
        if (!response.ok || response.status === 202) {
          await response.body?.cancel();
          throw new SearchError(response.status === 429 ? 'rate_limited' : 'http_error', `网站返回 HTTP ${response.status}；不绕过验证码或访问限制。`);
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (contentType && !/^(text\/(html|plain|markdown|xml)|application\/(xhtml\+xml|rss\+xml|atom\+xml|xml|json))\b/.test(contentType)) {
          await response.body?.cancel();
          throw new SearchError('unsupported_type', '仅读取 HTML、纯文本、Markdown、XML 或 JSON；不下载 PDF、Office、图片或二进制文件。');
        }
        return { text: await cappedText(response, maxBytes), url: url.href, contentType };
      } finally { await dispatcher.destroy(); }
    }
    throw new SearchError('redirect_limit', '页面重定向过多。');
  };
}

export function errorSummary(error) {
  if (error instanceof SearchError) return { code: error.code, message: error.message };
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return { code: 'timeout', message: '请求已超时或取消。' };
  const code = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return { code: 'dns_error', message: '域名解析失败，请检查网络或 DNS。' };
  if (typeof code === 'string' && /^(UND_ERR|ECONN|ETIMEDOUT|ERR_TLS|CERT_|DEPTH_|UNABLE_)/.test(code)) return { code: 'network_error', message: `网络或证书校验失败（${code}）。` };
  return { code: 'internal_error', message: `搜索适配器发生异常（${error?.name ?? 'Error'}），请报告问题；这不是无搜索结果的证据。` };
}
