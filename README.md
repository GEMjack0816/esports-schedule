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
                                      └─ 按游戏写入最后成功 Runtime Cache 快照

/ 和 /api/matches ─> 快速读取快照 ─> 合并人工比赛与覆盖 ─> 返回客户端
```

生产 Vercel 团队当前是 Hobby 套餐，Vercel Cron 的最短可用频率是每天一次。因此 `vercel.json` 保留每日保底任务，15 分钟独立调度由 `.github/workflows/sync-schedule.yml` 承担。GitHub 仓库必须配置与 Vercel 相同值的 Actions Secret `CRON_SECRET`；工作流和接口都不会打印该值。

页面和 `/api/matches` 不等待 PandaScore。发现快照过期时，Next.js `after()` 会把刷新登记到当前 Vercel Function 的 `waitUntil` 生命周期，然后立即返回上一次成功快照。外部定时任务仍是保持低流量时段新鲜度的主要机制，访问触发只是补救。

所有函数固定在 `iad1`。实例内 single-flight 复用同一个 Promise，Runtime Cache 租约负责同一区域实例间互斥；租约为 6 分钟，长于函数 5 分钟上限。Runtime Cache 没有原子 CAS，因此它不是跨区域数据库锁，本项目通过单区域部署、GitHub Actions `concurrency` 和租约确认共同避免重复同步。如果未来改成多区域，应把锁和快照迁移到支持原子 `SET NX` 的 Redis 或数据库。

同步失败或 API 返回异常空列表时不会覆盖该游戏最后成功快照。五个游戏使用 `Promise.allSettled()` 隔离失败。人工王者荣耀数据和 `manual-matches.json` 在 API 数据之后合并，不会被同步删除。

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

每个游戏也返回同样的时间和状态字段，以及端点分页、X-Total、原始/规范化/去重/最终数量。同步尝试不会让快照变新；只有成功写入最后成功快照才会更新源时间。

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
```

没有 `PANDASCORE_TOKEN` 时，本地只返回可用的上次缓存/人工数据并明确标记数据源未配置，不会生成模拟比赛。不要为了测试把真实 Token 写入仓库。

## Vercel 部署后验证

1. 确认本地目录仍链接到 Vercel 项目 `esports-schedule`，Production 环境存在 `PANDASCORE_TOKEN` 和 `CRON_SECRET`。
2. 在 GitHub 私有仓库的 Actions secrets 添加同名 `CRON_SECRET`，值与 Vercel Production 一致。
3. 推送 `main`，等待现有 Vercel 项目的 Production Deployment 变为 Ready；不要新建项目。
4. 手动运行一次 GitHub Actions 的 `Sync esports fixtures`，确认成功。
5. 请求 `https://esports-schedule-two.vercel.app/api/health/data-coverage`，确认 `mode=live`、`demoMode=false`，并核对上述七个健康字段。
6. 连续并发请求 `/api/matches`；响应应快速返回同一快照，日志中同一时刻只能有一条 `regional refresh lock acquired`。
7. 等待一次定时周期，确认 `sourceFetchedAt` 和各游戏 `sourceFetchedAt` 前进；失败测试时确认旧快照数量仍可用且 `lastSuccessfulSyncAt` 不变。
8. 使用无登录浏览器检查桌面端和 390px 手机端、五个游戏筛选、`scheduled/running/finished` 状态筛选及控制台错误。

GitHub 定时任务可能因平台负载延迟几分钟；私有仓库还需确认账户包含足够的 Actions 分钟数。若不希望使用 Actions，应使用支持 15 分钟频率的外部调度器调用同一个受保护接口，不能把 Hobby 的每日 Vercel Cron 描述为 15 分钟刷新。
