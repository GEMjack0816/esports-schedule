# 比赛提交与审核运维

公开的 `POST /api/submissions` 把经过大小、类型、URL、时间、BO 赛制和蜜罐校验的记录写入 PostgreSQL。相同游戏、赛事、双方和开赛时间的待审核/已批准记录使用指纹约束去重。数据库不可用时接口返回 `503`，不会伪装成成功或退回易失缓存。

## 数据库

数据库由 Drizzle 管理：

- `match_submissions`：公开提交及审核状态；
- `published_manual_matches`：审核通过后公开的人工比赛；
- `admin_audit_events`：编辑、批准、驳回、隐藏和恢复的审计记录。

`npm run db:generate` 生成迁移；`npm run db:migrate` 只应对明确选择的数据库执行。Preview 必须使用独立数据库或独立分支，禁止把验证脚本连接到 Production 数据库。`npm run db:check` 只检查连接和表是否存在，不打印连接字符串。

## 管理员 OAuth

管理员入口为 `/admin/login`，使用 Sign in with Vercel Authorization Code + PKCE。服务端验证 OAuth state、PKCE verifier、ID Token 签名、issuer、audience、expiry、nonce，并以 ID Token 的稳定 `sub` 对照 `ADMIN_VERCEL_USER_IDS`。会话 Cookie 为 Secure、HttpOnly、SameSite=Lax；访问令牌只保存在加密 HttpOnly Cookie 中，并仅在退出时用于撤销。管理页面设置 `noindex, nofollow`，所有数据查询都在服务端重新鉴权。

审核通过使用单一数据库事务：锁定待审核行、创建公开比赛、更新提交状态并写审计事件。驳回不会创建公开比赛。人工比赛更新、隐藏和恢复后会重新验证 `published-manual-matches` 标签。

公开赛程按 PandaScore 快照 → 静态 JSON 补录/覆盖 → PostgreSQL 已发布比赛合并，并继续以 `provider + providerMatchId` 去重。数据库读超时或暂时失败时，公开赛程保留最近一次成功读取的已发布人工比赛缓存，不会删除 PandaScore 或静态人工数据，也不会进入演示模式。健康接口的 `database` 字段只返回连接状态、最近成功读取时间、缓存人工比赛数和聚合提交计数；不返回连接信息、SQL、原始错误或任何 Secret。

## 环境变量

| 环境 | 名称 | 用途 |
| --- | --- | --- |
| Vercel Production/isolated Preview | `DATABASE_URL` | PostgreSQL 连接；Preview 必须隔离 |
| Vercel Production/isolated Preview | `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` | Vercel OAuth 公共 client ID |
| Vercel Production/isolated Preview | `VERCEL_APP_CLIENT_SECRET` | Vercel OAuth 服务端 client secret |
| Vercel Production/isolated Preview | `ADMIN_VERCEL_USER_IDS` | 逗号分隔的管理员稳定 `sub` 白名单 |

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
npm run verify:admin -- <isolated-preview-url>
```

`verify:admin` 会拒绝生产 Alias，并且只有在显式标记隔离环境且提供已认证浏览器状态时才执行公开提交、批准、编辑、隐藏、恢复、驳回和审计验证。
