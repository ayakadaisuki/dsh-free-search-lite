# 轻量免费搜索 · Free Search Lite

为 **DeepSeek Harness（dsh）** 提供无需 API Key 的联网搜索和网页正文读取。这是社区插件，不是 DeepSeek 官方产品，也不是 npm 上已有的 `dsh-free-search`。

## 安装后得到什么

- `free_search`：中英文公网搜索，返回标题、原始网址、摘要、来源和引擎状态。
- `free_search_fetch`：读取 HTML/文本页面正文，长内容按字符分页，保留代码块。
- 360 与 Bing RSS 并行搜索，结果不足时回退到 DuckDuckGo；去重、合并来源并丢弃明显离题结果。
- 无 Python、虚拟环境、浏览器、Playwright、MCP 子进程、管理网页、数据库或 API Key。
- **无需配置。** 安装并启用后工具由 dsh 自动发现，不要求选择专用预设。

## 兼容版本

已验证 **DeepSeek Harness `0.2.1-rc.3` / Node.js 24.21.0 / Windows x64**，最低 Node.js 24.14.0。插件的 dsh peer 版本与该预览版精确匹配。其他 dsh 版本必须重新验证后发布，不能通过跳过兼容性检查强行安装。

本项目只有 Node.js 代码，没有平台原生依赖；macOS/Linux 尚未实测。

## 安装

源代码仓库：[ayakadaisuki/dsh-free-search-lite](https://github.com/ayakadaisuki/dsh-free-search-lite)。仓库保留预构建的 `lib/`，无需用户手工构建。

预构建安装包：[v0.1.1 / dsh-free-search-lite-0.1.1.tgz](https://github.com/ayakadaisuki/dsh-free-search-lite/releases/download/v0.1.1/dsh-free-search-lite-0.1.1.tgz)。

在官方 dsh 桌面端打开 **插件 → 添加插件**，使用 GitHub 仓库地址 `https://github.com/ayakadaisuki/dsh-free-search-lite`；也可以选择从源码构建的 `dsh-free-search-lite-0.1.1.tgz` 安装包。确认安装来源并启用“轻量免费搜索”。如界面提示需要重启，按提示重启。桌面端管理的 `desktop` profile 请通过桌面界面安装，不要用外部 CLI 修改它。

对于由 CLI 管理的 Web profile，可使用：

```sh
dsh plugin --profile web add github:ayakadaisuki/dsh-free-search-lite
```

本项目不依赖 npm 发布；**未宣称已被插件市场收录**。收录须以市场维护者的合并结果为准。发布与收录流程见 [PUBLISH.md](PUBLISH.md)。

## 试用

> 使用 free_search 搜索 DeepSeek Harness 官方 GitHub 仓库，然后用 free_search_fetch 读取结果中的一个官方介绍页面，给出两句摘要并附原始链接。

工具参数：

| 工具 | 必填 | 可选 |
| --- | --- | --- |
| `free_search` | `query`，1–500 字符 | `count`：1–15，默认 8；`refresh`：绕过缓存 |
| `free_search_fetch` | `url`，公网 HTTP(S) | `start`：起始字符，默认 0；`length`：1000–20000，默认 12000；`refresh`：重新抓取 |

分页时把上次返回的 `nextStart` 作为下次 `start`；`nextStart: null` 表示缓存中的正文已读完。最多保存 200000 字符，超出时 `sourceTruncated: true`。时间字段是抓取时间，不是网页发布日期。

## 与旧 free-search 预设的关系

本插件**不是旧 Python MCP 服务的启动器**。安装它不会改写默认模型、默认预设、已有 MCP 配置或其他插件。

原有 `free-search` 预设可以继续使用，新工具会与原工具并存。先确认本插件可用，再按需要手动停用旧 `mcp-free-search` 条目，避免重复工具。不要删除仍供旧预设使用的工具，也无需重新复制整个内置预设。

插件使用独立工具名，提示模型优先使用它，但不会强行隐藏内置搜索。如果特定预设自行限制可用工具，需要在该预设中允许 `free_search` 和 `free_search_fetch`。

## 安全、隐私与限制

- 搜索词会发送至 360、Bing，必要时发送至 DuckDuckGo；抓取网址会发送至相应网站。结果随后可进入所选模型的上下文。**零 API Key 不等于离线或完全本地。**
- 无遥测、分析上报、登录、Cookie 持久化或凭据读取。缓存在当前插件进程的内存中，保存 5 分钟，卸载/重启即清空；不是各会话隔离的缓存，返回 `cacheScope: process`。
- 只允许公网 HTTP(S) 和标准端口。阻止内网、回环、链路本地、保留地址、含账号密码的 URL；每次重定向重新验证 DNS，并在连接时固定已验证地址。
- 不绕过验证码、反爬、登录或付费限制。搜索引擎接口并非稳定官方 API：页面改版、地区、网络和限流都可能造成失败。`no_reliable_results` 不能解释成“信息不存在”。
- 不运行 JavaScript，不支持登录态、单页应用动态渲染、PDF/Office/图片/压缩包解析或下载。正文提取是启发式，不能代替原始网页。
- 单请求超时约 9–12 秒；最多 5 次重定向、2 MiB 解压后响应、4 个同时执行的工具调用。两个主引擎最多同时产生 8 个请求；繁忙时明确拒绝，而不无限排队。
- 仅使用直连 HTTPS/HTTP；不自动读取系统代理、PAC、浏览器代理或 `HTTP_PROXY` 凭据。支持 Clash 全局/TUN 的常见 fake-IP 段：遇到 `198.18.0.0/15` 或 `fdfe:dcba:9876::/64` 时，自动经 Cloudflare DNS-over-HTTPS 查询真实地址，服务不可用时回退 Google DNS-over-HTTPS；普通 DNS 不受影响。域名（不含搜索词、网页路径或正文）会发送给这些 DNS 服务。DoH 连接固定到公开引导 IP 并保持 HTTPS 证书校验；解析结果仍须全部为公网地址，连接仍固定到已校验地址。不会直接放行 fake-IP、内网地址或不安全重定向；不修改 Clash 配置。其他自定义 fake-IP 段仍安全拒绝。
- dsh 插件在宿主进程执行，不等于工作区沙箱内执行。调用仍进入 dsh 的正常工具策略管线；插件不更改用户授权策略。

## 开发与验证

```sh
npm ci --legacy-peer-deps
npm test
npm run build
npm run test:live
npm pack --pack-destination releases
```

构建时把纯 JavaScript 依赖打包进 `lib/index.js`。运行时只依赖 Node 内建模块和 dsh 提供的服务，没有需要用户额外安装的运行依赖。

`scripts/test-host.mjs` 在隔离的 Cordis Context 中使用本机安装包内的真实 ToolRuntime/SystemPrompt，验证注册、模型可见 schema、工具执行、内网拒绝和卸载。它不修改用户 profile，也不调用模型 API。Windows 下须使用 dsh 自带 Electron 的 `ELECTRON_RUN_AS_NODE=1` 运行，并设置 `DSH_INSTALL_ROOT`。

## 来源与许可证

MIT。搜索适配器思路和部分选择器移植自 [sweetcornna/free-search-mcp](https://github.com/sweetcornna/free-search-mcp) `0.13.1`（Copyright © 2026 ymylive），保留其许可证；其余浏览器、OAuth、研究代理、文档解析、数据库、下载和管理后台未移植。

构建所含第三方组件的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `lib/index.js.LEGAL.txt`。代码许可不替代搜索引擎或目标网站的使用条款。
