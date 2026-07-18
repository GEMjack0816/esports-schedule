# 赛界 PULSE

英雄联盟、无畏契约、王者荣耀、CS2、Dota 2 电竞赛程聚合站。支持本地时区、日期/游戏/赛事/战队/状态筛选、比分、BO 赛制与直播链接，适配桌面和手机。

## 数据源与密钥

- 英雄联盟、无畏契约、CS2、Dota 2：PandaScore 免费 Fixtures API。
- 王者荣耀：`src/data/honor-of-kings.json` 人工录入，通过独立适配器接入。
- 未配置 PandaScore Token 时：自动启用明确标注的演示赛程，避免页面空白。

PandaScore Token 仅由服务端使用，不会发送到客户端，也不要添加 `NEXT_PUBLIC_` 前缀。复制 `.env.example` 为 `.env.local` 后填写 `PANDASCORE_TOKEN` 和至少 16 位的 `CRON_SECRET`。

## 检查与接口

运行 `npm run check` 执行 TypeScript、ESLint 和生产构建检查。

- `GET /api/matches`：聚合后的公开赛程。
- `GET /api/cron/sync`：Vercel Cron 更新入口，要求 `Authorization: Bearer $CRON_SECRET`。
- `vercel.json`：每天 18:15 UTC 自动更新赛程。

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
