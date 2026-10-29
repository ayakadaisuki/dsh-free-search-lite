# Free Search Lite for DeepSeek Harness

[中文](README.md)

A community DSH plugin exposing two tools, `free_search` and `free_search_fetch`. No API keys, browser downloads, Python, virtual environments, MCP subprocesses or setup fields. It is not the existing npm package `dsh-free-search` and is not an official DeepSeek product.

## Installation

Tested with DSH **0.2.1-rc.3**, Node 24.21.0, Windows x64. Requires Node >=24.14.0. DSH peers are intentionally pinned to the tested preview runtime.

Source repository: [ayakadaisuki/dsh-free-search-lite](https://github.com/ayakadaisuki/dsh-free-search-lite). The prebuilt `lib/` is committed; users do not need to build it manually.

Prebuilt package: [v0.1.1 / dsh-free-search-lite-0.1.1.tgz](https://github.com/ayakadaisuki/dsh-free-search-lite/releases/download/v0.1.1/dsh-free-search-lite-0.1.1.tgz).

In DSH desktop, use **Plugins → Add plugin** with `https://github.com/ayakadaisuki/dsh-free-search-lite`, or select a locally built `dsh-free-search-lite-0.1.1.tgz`. Enable the plugin and restart if prompted. Use the desktop UI for the Electron-managed `desktop` profile, not an external CLI.

For a CLI-managed Web profile:

```sh
dsh plugin --profile web add github:ayakadaisuki/dsh-free-search-lite
```

npm publication is not required. Marketplace inclusion is subject to maintainer approval; this README does not claim the plugin is already listed. See [PUBLISH.md](PUBLISH.md) for the release process.

Once enabled, the plugin registers its tools globally. It does not rewrite presets, model settings, credentials, existing MCP servers or your default tool selection. A preset with an explicit tool allowlist must allow the two new names.

## Tools

- `free_search({query, count?, refresh?})`: ranked titles, original URLs, snippets, source engines and diagnostics. Count defaults to 8, maximum 15. 360 and Bing RSS run concurrently; DuckDuckGo is a best-effort fallback for sparse results.
- `free_search_fetch({url, start?, length?, refresh?})`: static article text, source URL and pagination. Length defaults to 12000 and is limited to 1000–20000. Use `nextStart` for the next page. Code-block indentation is retained.

Try: “Use free_search to find the official DeepSeek Harness repository, then use free_search_fetch to read an official page and summarize it with source links.”

## Limits and privacy

Queries go to the selected search engines; requested pages go to the corresponding sites. Results can enter your model provider's context. There is no plugin telemetry or credential access. Five-minute bounded in-memory caches are shared within the plugin process, not session-isolated; use refresh to bypass them.

Public HTTP(S) only, standard ports, no credentials, cookies or private/internal/reserved addresses. DNS is validated and pinned, including every redirect. Maximum response is 2 MiB after decompression, five redirects and four concurrent tool calls. There is no JavaScript rendering, PDF/Office parsing, login, CAPTCHA bypass, download manager or browser automation.

Requests use direct connections, not system/PAC/environment proxies. For Clash TUN DNS answers in `198.18.0.0/15` or `fdfe:dcba:9876::/64`, the plugin resolves the hostname through Cloudflare DNS-over-HTTPS, with Google DNS-over-HTTPS as a service-failure fallback. Only hostnames, not queries, page paths or content, are sent to these DNS providers. Their bootstrap public IPs are pinned and HTTPS certificate verification stays enabled. All resulting target addresses must still be public and are pinned for each connection and redirect; fake IP literals, private answers and unknown fake-IP ranges remain blocked. Ordinary system DNS and Clash settings are unchanged. Free search endpoints can change or block requests: diagnostics are explicit, and empty results never prove absence. Extraction and relevance filtering are heuristic.

## Development

```sh
npm ci --legacy-peer-deps
npm test
npm run build
npm run test:live
```

The shipped JavaScript bundle contains its dependencies and requires no install-time build scripts. `scripts/test-host.mjs` verifies the real installed DSH tool runtime in an isolated Context without modifying profiles or invoking a model.

MIT. Search adapter logic is derived in part from [sweetcornna/free-search-mcp](https://github.com/sweetcornna/free-search-mcp) 0.13.1, Copyright (c) 2026 ymylive. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
