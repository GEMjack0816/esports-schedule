# 比赛提交与审核运维

公开的 `POST /api/submissions` 把经过大小、类型、URL、时间和 BO 赛制校验的记录写入 PostgreSQL。接口使用 Vercel 提供的来源 IP 生成不可逆摘要，同时执行三层原子窗口保护：每来源 15 分钟最多 5 次、全站 15 分钟最多 300 次有效请求、每 15 分钟最多为 100 个新来源创建持久化状态；全局 pending 队列仍限制为 500 条。计数、队列检查和写入由事务保护，入口 gate 使用有 200 ms 总等待上限的 `pg_try_advisory_xact_lock` 重试，竞争时返回 `429`，不会无限排队。超限、服务繁忙或队列已满都返回 `Retry-After`。蜜罐只作为补充信号，不是主要保护。相同游戏、赛事、双方和开赛时间的待审核/已批准记录继续使用指纹约束去重。

新来源的限流行只在比赛不是重复项且队列仍有容量时创建；queue-full 和来自新来源的 duplicate 不会扩张 `submission_rate_limits`。全局请求计数仍会覆盖 duplicate 流量，因此不能通过重复内容绕过请求级保护。来源行至少保留一小时；清理每五分钟至多运行一次，每次按 `updated_at` 索引最多删除 200 条，避免全表删除或把清理本身变成高成本路径。数据库不可用时接口返回 `503`，不会伪装成成功或退回易失缓存。

## 数据库

数据库由 Drizzle 管理：

- `match_submissions`：公开提交及审核状态；
- `published_manual_matches`：审核通过后公开的人工比赛；
- `submission_rate_limits`：只保存来源摘要和当前限流窗口，不保存原始 IP；
- `submission_rate_limit_windows`：固定 key 的全局请求、新来源数量和清理节流窗口；
- `admin_audit_events`：编辑、批准、驳回、隐藏和恢复的审计记录。

`npm run db:generate` 生成迁移；`npm run db:migrate` 只应对明确选择的数据库执行。Preview 必须使用独立数据库或独立分支，禁止把验证脚本连接到 Production 数据库。`npm run db:check` 只检查连接和表是否存在，不打印连接字符串。

## 管理员 OAuth

管理员入口为 `/admin/login`，使用 Sign in with Vercel Authorization Code + PKCE。服务端验证 OAuth state、PKCE verifier、ID Token 签名、issuer、audience、expiry、nonce，并以 ID Token 的稳定 `sub` 对照 `ADMIN_VERCEL_USER_IDS`。Vercel Preview/Production 会话 Cookie 使用 `__Host-` 前缀并设置 Secure、HttpOnly、SameSite=Lax；本地 HTTP 验证使用不带 `__Host-` 的 HttpOnly、SameSite=Lax Cookie，避免浏览器拒绝不符合前缀约束的 Cookie。访问令牌只保存在加密 HttpOnly Cookie 中，并仅在退出时用于撤销。管理页面设置 `noindex, nofollow`，所有数据查询和每一次 Server Action 都在服务端重新鉴权；管理 Route Handler 的写请求还会校验同源 `Origin`。

审核通过使用单一数据库事务：锁定待审核行、创建公开比赛、更新提交状态并写审计事件。驳回不会创建公开比赛。待审核记录的保存、批准、驳回以及人工比赛的编辑、隐藏、恢复都会携带页面加载时的 `updatedAt`；事务在行锁内校验版本，并在不匹配时拒绝旧表单覆盖。更新时间保证单调递增，冲突页面会要求管理员重新加载。

公开赛程按 PandaScore 快照 → 静态 JSON 补录/覆盖 → PostgreSQL 已发布比赛合并，并继续以 `provider + providerMatchId` 去重。Next Data Cache 使用 `published-manual-matches` 标签；Runtime Cache 的故障降级快照使用独立的 `published-manual-matches-fallback-v1` 标签。批准、创建、编辑、隐藏或恢复事务成功后会先从数据库重建 Runtime Cache 快照，再通过 `updateTag` 立即失效 Next Data Cache，避免旧快照在数据库故障时重新出现。数据库读超时或暂时失败时，公开赛程保留最近一次成功读取的已发布人工比赛缓存，不会删除 PandaScore 或静态人工数据，也不会进入演示模式。健康接口的 `database` 字段只返回连接状态、最近成功读取时间、缓存人工比赛数和聚合提交计数；不返回连接信息、SQL、原始错误或任何 Secret。

代码侧保护不依赖 Vercel Firewall。上线前仍建议由项目管理员在 Vercel Dashboard 为 `POST /api/submissions` 增加独立速率规则作为纵深防御；该配置不应替代 PostgreSQL 原子限流。

## 环境变量

| 环境 | 名称 | 用途 |
| --- | --- | --- |
| Vercel Production/isolated Preview | `DATABASE_URL` | PostgreSQL 连接；Preview 必须隔离 |
| Vercel Production/isolated Preview | `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` | Vercel OAuth 公共 client ID |
| Vercel Production/isolated Preview | `VERCEL_APP_CLIENT_SECRET` | Vercel OAuth 服务端 client secret |
| Vercel Production/isolated Preview | `ADMIN_VERCEL_USER_IDS` | 逗号分隔的管理员稳定 `sub` 白名单 |
| Vercel Preview verification branch only | `ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS` | 允许 `verify:admin` 写入的隔离 Preview PostgreSQL 精确 hostname 列表；不得包含 Production hostname，不支持通配符 |
| Vercel Preview verification branch only | `ADMIN_VERIFY_PREVIEW_GIT_REFS` | 服务端 preflight/cleanup 允许的精确 Preview Git ref 列表；必须 branch-scoped，不支持通配符或 `main` |

这些变量不替代或改变现有的 `PANDASCORE_TOKEN` 与 `CRON_SECRET`。不要把任何真实值写入仓库。

## 旧提交迁移

旧 Runtime Cache 提交可由已登录管理员一次性调用 `POST /api/admin/legacy-import` 导入。导入保留 UUID 和提交时间，按主键/指纹幂等跳过重复项并写审计记录；它不会删除旧缓存。

## 隔离环境验证

```powershell
npm run db:migrate
npm run db:check
npm start
npm run verify:browser -- http://localhost:3000
$env:ALLOW_ISOLATED_ADMIN_VERIFY = "1"
$env:ADMIN_STORAGE_STATE = "<authenticated-playwright-storage-state>"
$env:ADMIN_VERIFY_PREVIEW_HOSTS = "<preview-alias-host>,<unique-deployment-host>"
npm run verify:admin -- <isolated-preview-url> <expected-preview-branch> <expected-full-commit-sha>
```

运行前必须在当前验证分支的 Vercel **Preview-only、branch-scoped** 环境中配置 `ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS` 与 `ADMIN_VERIFY_PREVIEW_GIT_REFS`。前者只列出此隔离数据库连接主机名（逗号分隔，不含 scheme、端口、路径或通配符）；后者只列出获准执行 E2E 的精确 Git ref（逗号分隔，不支持通配符或 `main`）。两者都不是 Secret，但只可由服务端读取；禁止加入 `NEXT_PUBLIC_`。不要把 Production 数据库主机加入列表。缺失、格式错误或不匹配时，服务端预检和清理端点都会 fail closed。

`verify:admin` 在任何写入前都会要求 HTTPS URL 精确命中 `ADMIN_VERIFY_PREVIEW_HOSTS`，并使用已认证的浏览器状态读取 `/api/version`。只有服务名、`environment=preview`、Git ref、完整 commit SHA、Deployment ID 和 deployment URL 全部符合预期后，脚本还必须调用管理员同源 `/api/admin/e2e-preflight`；该端点在服务端将当前 `DATABASE_URL` 主机与 `ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS` 作精确匹配。仅当预检返回 `{ "ok": true }` 才会开始测试写入。API 不返回数据库主机或连接信息。生产域名、未列入 allowlist 的 host、缺失元数据及 SHA/ref 不匹配均 fail closed。

测试提交在备注和来源链接中写入随机 run marker。验证通过部署指纹及服务端数据库预检后，即使尚未确认某次提交请求的响应，脚本也会在 `finally` 中按 run marker 调用管理员清理 API；清理可安全重试。该 API 仅在具有完整部署指纹、Git ref 命中 branch-scoped Preview allowlist 且数据库 hostname 命中 Preview allowlist 的 Vercel Preview deployment 中启用，且要求管理员 session、同源 Origin 和有效 run marker。它在一个数据库事务中删除本次测试提交、由其发布的比赛及关联审计行，并同步/失效公开比赛缓存。Production、未列入 allowlist 的 ref、Production 数据库 host 和缺失部署元数据时始终 fail closed。若清理失败，脚本会以非零状态失败并报告 run ID，不能将 E2E 误报为通过。
