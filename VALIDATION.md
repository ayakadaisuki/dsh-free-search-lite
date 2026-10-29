# Release validation

Validation date: 2026-10-29 (Asia/Shanghai). Package: `dsh-free-search-lite` 0.1.1.

## Verified

- Clean lockfile dependency installation (`npm ci --legacy-peer-deps --ignore-scripts`).
- Standard `npm test`: **71 passed, 0 failed** on Node.js 24.14.1 / Windows x64.
- Live English and Chinese queries returned relevant results; static Node.js page extraction retained readable text/code.
- Real installed DeepSeek Harness 0.2.1-rc.3 integration: exactly `free_search` and `free_search_fetch` schemas, private URL rejection, successful search and page extraction, and tool removal on plugin unload.
- Marketplace entry shape checked with the upstream `readEntries` / `validateEntries` implementation.

## Interpretation

Live search is best-effort. During the English smoke query, 360 timed out and Bing results were discarded as irrelevant; DuckDuckGo fallback produced relevant results. The Chinese query succeeded through 360. These checks demonstrate fallback behavior, not guaranteed engine availability or complete search coverage.

No model API was called and no user profile was changed by the integration test. The package pins the tested DSH preview peers. macOS/Linux and other DSH versions have not been tested.

A new GitHub repository must reach the market's one-day age threshold. Local tests and a submitted pull request are not marketplace approval; only upstream maintainer review/merge establishes inclusion.
