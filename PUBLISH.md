# 发布与市场收录

## 项目与兼容性

- 仓库：https://github.com/ayakadaisuki/dsh-free-search-lite
- 包名与版本：`dsh-free-search-lite` / `0.1.1`
- 已验证宿主：DeepSeek Harness `0.2.1-rc.3`，不宣称所有未来版本兼容。
- 本次通过 GitHub 发布源码和预构建 `lib/`，不依赖 npm 发布。
- 许可证：MIT；保留 free-search-mcp 上游署名以及打包第三方许可证。

## 维护者发版检查

```sh
npm ci --legacy-peer-deps
npm test
npm run build
npm run test:live
npm pack --pack-destination releases
```

使用 README 说明的真实宿主测试，检查生成包中的 manifest、`lib/`、locale、patch、许可证和文档。不要上传 `node_modules`、临时文件、凭据、个人测试报告或用户 profile。仓库的预构建 `lib/` 必须与当前源码一致。

包没有 `install`、`postinstall` 或 `prepare` 脚本。`prepack` 用于维护者构建与测试；预构建 tarball 的消费者不需要手动构建。

若发布 GitHub Release，可附加 `dsh-free-search-lite-0.1.1.tgz`，使用固定 tag 下载链接；如采用 `latest/download/`，资产名应不带版本号。上传后验证实际下载链接，再加入市场条目的可选 `tarball` 字段。

## 申请社区市场收录

以 [官方 contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 为准（2026-10-29 阅读）。只新增 `data/plugins/ayakadaisuki__dsh-free-search-lite.yml`，不要手工改生成的 README，也不要修改其他插件条目。

```yaml
url: https://github.com/ayakadaisuki/dsh-free-search-lite
name: ayakadaisuki/dsh-free-search-lite
category: browser
description:
  en: 'Key-free Chinese/English web search and static webpage text extraction with two tools, without a browser, Python or MCP subprocess.'
  zh: '免 API Key 的中英文联网搜索与静态网页正文读取，提供两个工具，无需浏览器、Python 或 MCP 子进程。'
```

仓库须公开，包含 `dsh.bundle` manifest、真实可运行代码和 `dsh-plugin` topic，创建满 1 天。新建仓库未满一天时不能通过年龄检查；不要伪造日期或提交空 commit 绕过，按官方规则等待检查重跑。CI 通过只是前置条件，最终收录由维护者评审合并决定，提交 PR 不等于已收录。

## 可选 npm 发布

npm 发布不属于当前 GitHub 收录所必需步骤。如未来选择 npm，发布者必须先确认包名、登录身份和公开发布权限，再发布已检查的 tarball，并验证 registry 中版本、完整性和 `repository` 字段。不得用尚未发布的 npm 包生成可安装市场索引。

`scripts/market-index.mjs --published-at <真实Unix秒>` 仅供未来 npm 发布后生成自定义索引；输入时间须来自真实 registry 元数据。

## 旧服务共存

插件不会自动修改已有 Python MCP 服务、预设、默认模型或其他插件。先验证新工具，再按个人需要停用旧服务；不要把本机迁移操作写入通用发布包。
