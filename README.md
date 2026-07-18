# 赛界 PULSE

英雄联盟、无畏契约、王者荣耀、CS2、Dota 2 电竞赛程聚合站。支持本地时区、日期/游戏/赛事/战队/状态筛选、比分、BO 赛制与直播链接，适配桌面和手机。

## 数据源与密钥

- 英雄联盟、无畏契约、王者荣耀、CS2、Dota 2：PandaScore Fixtures API，对应 `lol`、`valorant`、`kog`、`csgo`、`dota2`。
- PandaScore 按游戏和 upcoming/running/past 分别完整分页，覆盖未来 60 天与过去 30 天。
- `src/data/honor-of-kings.json` 保留为王者荣耀补漏；五个游戏都可通过 `src/data/manual-matches.json` 添加 API 未收录比赛或覆盖自动数据。
- 五个游戏分别保存 Runtime Cache 快照。单个游戏失败或异常返回空列表时，只保留该游戏上一次成功数据，其他游戏继续更新。访问触发的刷新使用区域锁和进程内 Promise 复用，避免同一区域的并发请求重复消耗 PandaScore 配额。
- 401、429、5xx、网络超时会分类记录；429、5xx 和临时网络错误最多指数退避重试两次。
- 生产环境不会用演示比赛替代真实数据。

PandaScore Token 仅由服务端环境变量 `PANDASCORE_TOKEN` 使用，不会发送到客户端，也不要添加 `NEXT_PUBLIC_` 前缀。Vercel Cron 使用独立的 `CRON_SECRET`。

`manual-matches.json` 使用 `schemaVersion: 2`，包含：

- `matches`：已审核的补漏比赛。
- `overrides`：按 `provider + providerMatchId` 覆盖开始时间、状态、队名、赛事信息、比分和直播，或通过 `hidden: true` 隐藏错误比赛。
- 只有 `reviewStatus: "approved"` 的记录会公开，`pending` 不会进入公开赛程。

## 检查与接口

运行 `npm run check` 执行 TypeScript、ESLint、Vitest、生产构建和客户端密钥扫描。

- `GET /api/matches`：聚合后的公开赛程。
- `GET /api/health/data-coverage`：不含密钥的分页、X-Total、去重、时间范围和额度诊断。
- `POST /api/submissions`：保存用户提交的遗漏赛事为待审核状态，不直接公开。
- `/submit-match`：遗漏赛事提交表单。
- `GET /api/cron/sync`：Vercel Cron 更新入口，要求 `Authorization: Bearer $CRON_SECRET`。
- `vercel.json`：每天 18:15 UTC 自动同步。15 分钟是有访问流量时的刷新新鲜度目标：页面/API 发现任一游戏快照过期后尝试刷新；每日 Cron 只是低流量时期的保底触发，并不等于全天每 15 分钟自动运行。超过 15 分钟显示延迟，超过 60 分钟显示同步失败，页面始终展示实际最后成功同步时间。
- 公开页面和 `/api/matches` 不缓存完整响应，防止 Alias 切换后浏览器或 CDN 继续显示旧模式；PandaScore 上游结果和最后成功快照仍在服务端缓存。刷新失败时返回上次成功的真实数据并标记过期，不生成替代赛程。

---

This is a [Next.js](https://nextjs.org) project bootstrapped with `create-next-app`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
