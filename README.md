# 赛界 PULSE

聚合英雄联盟、无畏契约、王者荣耀、CS2 和 Dota 2 主要职业及半职业比赛的 Next.js 网站。服务端保存 UTC 时间，浏览器按访问者时区显示；页面支持日期、游戏、赛事、战队和比赛状态筛选。

## 数据链路

```text
GitHub Actions（每 15 分钟） ─┐
Vercel Cron（每日保底） ──────┼─> /api/cron/sync
过期快照的页面/API 请求 ──────┘       │
                                      ├─ 区域租约 + 实例 single-flight
                                      ├─ PandaScore 五游戏 × 3 端点
                                      ├─ 每页 100 + 完整分页 + 超时/重试
                                      └─ 按游戏 CAS 写入 PostgreSQL 最后成功快照
                                           └─ 再写入 Runtime Cache 快速层

/ 和 /api/matches ─> Runtime Cache ─miss─> PostgreSQL 最后成功快照
                                     │          │
                                     │          └─ best-effort 回填 Runtime Cache
                                     └─> 合并人工比赛与覆盖 ─> 返回客户端
```

生产 Vercel 团队当前是 Hobby 套餐，Vercel Cron 的最短可用频率是每天一次。因此 `vercel.json` 保留每日保底任务，15 分钟独立调度由 `.github/workflows/sync-schedule.yml` 承担。GitHub 仓库必须配置与 Vercel 相同值的 Actions Secret `CRON_SECRET`；工作流和接口都不会打印该值。

页面和 `/api/matches` 不等待 PandaScore。发现快照过期时，Next.js `after()` 会把刷新登记到当前 Vercel Function 的 `waitUntil` 生命周期，然后立即返回上一次成功快照。外部定时任务仍是保持低流量时段新鲜度的主要机制，访问触发只是补救；它不能替代持久化快照或提供严格调度保证。

所有函数固定在 `iad1`。实例内 single-flight 复用同一个 Promise，Runtime Cache 租约负责同一区域实例间互斥；租约为 6 分钟，长于函数 5 分钟上限。Runtime Cache 没有原子 CAS，因此它不是跨区域数据库锁，本项目通过单区域部署、GitHub Actions `concurrency` 和租约确认共同避免重复同步。每次同步在请求上游前从 PostgreSQL sequence 取得单调递增的 fencing generation，持久快照只接受更大的 generation；`sourceFetchedAt` 仅表示实际抓取时间，不参与同步先后排序。如果未来改成多区域，仍应把刷新租约迁移到支持原子互斥的数据库或 Redis。

`pandascore_game_snapshots` 每个游戏保存一行规范化 JSONB 快照、源时间、成功/尝试/错误元数据和 fencing generation。读取 Runtime Cache 时会先用五行轻量 generation 查询核对版本；只有缓存缺失或版本不一致才读取完整 JSONB 并回填缓存。PostgreSQL JSONB 会通过 TOAST 管理较大的单游戏值；五行主键读取避免逐比赛查询和写放大。同步失败、持久写失败或 API 返回异常空列表时不会清空该游戏最后成功快照。五个游戏使用 `Promise.allSettled()` 隔离失败。人工王者荣耀数据和 `manual-matches.json` 在 API 数据之后合并，不会被同步删除。

Runtime Cache 大快照使用有界 gzip 编码，压缩后仍超限时继续读取 PostgreSQL 完整快照，不截断比赛；格式兼容、解码上限和测试说明见 [缓存快照编码](docs/runtime-snapshot-cache.md)。

`/api/cron/sync` 返回 `lockAcquired`、`gamesAttempted`、`gamesSucceeded`、`gamesFailed`、`snapshotsPersisted`、时间和安全错误代码。GitHub Actions 使用 `scripts/validate-sync-response.mjs` 解析 JSON；HTTP 2xx 但未取得有效更新不再被判定为同步成功。锁竞争明确报告为 `busy`，不冒充一次刷新。

## 状态标准化

唯一的上游状态映射位于 `src/lib/schedule/status.ts`。站内枚举为：

- `scheduled`
- `running`
- `finished`
- `postponed`
- `cancelled`
- `forfeit`
- `unknown`

映射会处理大小写、空格、连字符以及 `live`、`started`、`completed` 等别名。未知非空状态会记入安全日志并保留为 `unknown`，不再按端点静默猜测。显式状态优先于时间；仅在状态为空时才用时间推断。PandaScore `/matches/running` 集合优先于同一比赛在 upcoming/past 缓存中的旧副本。

## 服务端环境变量

不要给任何密钥加 `NEXT_PUBLIC_` 前缀。

| 位置 | 名称 | 用途 |
| --- | --- | --- |
| Vercel Production | `PANDASCORE_TOKEN` | PandaScore 服务端请求 |
| Vercel Production | `CRON_SECRET` | 保护同步接口 |
| Vercel Production | `DATABASE_URL` | 持久化最后成功 PandaScore 快照和人工审核数据 |
| GitHub Actions Secret | `CRON_SECRET` | 调用生产同步接口；值需与 Vercel 一致 |

项目不会把 Token 返回给浏览器、健康接口或日志。`npm run test:client-bundle` 会扫描客户端构建产物。

## 健康接口

`GET /api/health/data-coverage` 返回非敏感诊断：

- `lastAttemptAt`：最近一次真正开始的同步尝试；
- `lastSuccessfulSyncAt`：最近一次任意游戏成功写入快照的时间；
- `sourceFetchedAt`：五个游戏中最旧的有效源快照时间；
- `snapshotAgeSeconds`：按 `sourceFetchedAt` 计算的年龄；
- `stale`：任一游戏缺失、失败或源快照超过 15 分钟；
- `refreshInProgress`：当前区域租约或本实例刷新是否运行；
- `lastError`：最近错误的时间、代码和 HTTP 状态，不含响应正文或密钥。
- `games.*.dataSource`：`fresh` / `cache` / `persistent` / `unavailable`，明确区分 Runtime Cache 与 PostgreSQL 恢复。

每个游戏也返回同样的时间和状态字段，以及端点分页、X-Total、原始/规范化/去重/最终数量。同步尝试不会让快照变新；只有成功写入 PostgreSQL 最后成功快照才会更新源时间。Runtime Cache miss 会读取 PostgreSQL 并回填快速层；只要持久快照存在，接口不会因为缓存逐出进入 `mode=unavailable`。快照超过 15 分钟仍会准确显示 `stale=true`。

## 生产版本指纹

`GET /api/version` 动态返回当前部署的公开版本信息，包括环境、Git commit/ref、Deployment ID/URL、构建时间和请求时间。接口只读取明确列入白名单的 Vercel 系统变量和构建期回退值，不枚举环境变量，也不读取或返回业务密钥、请求头或 Cookie。响应同时设置浏览器和 Vercel CDN 的 `no-store` 缓存策略。

`GET /api/health/data-coverage` 的 `version` 字段复用同一个服务端模块，提供 `gitCommitSha`、`deploymentId` 和 `buildTimestamp` 摘要。首页还包含一个隐藏的公开 commit 指纹，浏览器验证会将它与版本接口及健康接口交叉核对，避免把旧 Alias 或旧缓存误判成当前部署。

构建时间由 `next.config.ts` 在 `next build` 启动时生成，部署中的每次请求保持不变；`runtimeTimestamp` 则按请求生成。Git SHA 优先使用 Vercel 官方 `VERCEL_GIT_COMMIT_SHA`，若构建环境没有提供，则回退到构建工作区的 Git HEAD。

## 本地验证

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:client-bundle
npm start
```

另开终端执行：

```powershell
Invoke-RestMethod http://localhost:3000/api/health/data-coverage
npm run verify:browser -- http://localhost:3000
npm run verify:range-controls -- http://localhost:3000
npm run verify:production -- http://localhost:3000 <expected-git-sha>
```

没有 `PANDASCORE_TOKEN` 时，本地只返回可用的上次缓存/人工数据并明确标记数据源未配置，不会生成模拟比赛。不要为了测试把真实 Token 写入仓库。

`verify:range-controls` 仅接受 loopback 地址，使用全新无登录态浏览器检查 1440px/390px 下刷新与搜索控件的可访问名称、时间范围的方向键/Home/End 导航、单一 Tab 停靠点、tabpanel 关联，以及快捷范围清除日期覆盖；不提交比赛或执行管理员操作。

`npm run verify:list-window` 在构建后自行启动随机端口的 `127.0.0.1` 服务，不接受目标 URL，拒绝本地 `.env`（`.env.example` 除外），服务进程不继承数据库/OAuth/PandaScore/cron 凭据。全新 1440px/390px 浏览器上下文仅通过内存中的合成赛程验证 200 → 400 → 450 条渲染、筛选后重置、控制台和关键请求错误及横向溢出；外部请求和写请求全部阻断，不保存登录态、截图或响应。

PR/main 的代码质量 CI 在既有测试、构建和凭据扫描后，通过已锁定的 `playwright-core` CLI 安装 Chromium headless shell，并运行该隔离浏览器回归。Linux 本地可先执行 `node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium`；Windows 使用系统 Chrome 或显式 `CHROME_PATH`。这不是受保护 Preview 的 OAuth/数据库 E2E，不代替独立 Preview 验收，也不触发生产同步 workflow。

## Vercel 部署后验证

1. 确认本地目录仍链接到 Vercel 项目 `esports-schedule`，Production 环境存在 `PANDASCORE_TOKEN` 和 `CRON_SECRET`。
2. 在 GitHub 私有仓库的 Actions secrets 添加同名 `CRON_SECRET`，值与 Vercel Production 一致。
3. 推送 `main`，等待现有 Vercel 项目的 Production Deployment 变为 Ready；不要新建项目。
4. 手动运行一次 GitHub Actions 的 `Sync esports fixtures`，确认 JSON 校验报告至少一个游戏成功且 `snapshotsPersisted > 0`。
5. 请求 `https://esports-schedule-two.vercel.app/api/health/data-coverage`，确认 `mode=live`、`demoMode=false`，并核对上述七个健康字段。
6. 连续并发请求 `/api/matches`；响应应快速返回同一快照，日志中同一时刻只能有一条 `regional refresh lock acquired`。
7. 等待一次定时周期，确认 `sourceFetchedAt` 和各游戏 `sourceFetchedAt` 前进；失败测试时确认旧快照数量仍可用且 `lastSuccessfulSyncAt` 不变。
8. 使用无登录浏览器检查桌面端和 390px 手机端、五个游戏筛选、`scheduled/running/finished` 状态筛选及控制台错误。

版本和健康状态可使用同一个严格脚本核验；expected SHA 必须由命令行参数或 `EXPECTED_GIT_COMMIT_SHA` 提供，脚本本身不硬编码提交：

```powershell
npm run verify:production -- https://esports-schedule-two.vercel.app <production-git-sha>
```

GitHub 定时任务可能因平台负载延迟几分钟；私有仓库还需确认账户包含足够的 Actions 分钟数。若不希望使用 Actions，应使用支持 15 分钟频率的外部调度器调用同一个受保护接口，不能把 Hobby 的每日 Vercel Cron 描述为 15 分钟刷新。
