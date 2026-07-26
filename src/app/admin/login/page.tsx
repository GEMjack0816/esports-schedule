import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession, isAdminAuthConfigured } from "@/lib/auth/vercel";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  if (await getAdminSession()) redirect("/admin");
  const returnTo = (await searchParams).returnTo;
  const target = returnTo?.startsWith("/admin") ? returnTo : "/admin";
  const configured = isAdminAuthConfigured();
  return (
    <main className="admin-card">
      <p className="section-index">ADMIN / PRIVATE</p>
      <h1>赛程审核管理</h1>
      <p>使用已加入白名单的 Vercel 账户登录。管理页面不会被搜索引擎收录。</p>
      {configured ? (
        <a className="admin-primary" href={`/api/auth/authorize?returnTo=${encodeURIComponent(target)}`}>
          Sign in with Vercel
        </a>
      ) : (
        <p role="alert">管理员 OAuth 尚未配置。</p>
      )}
      <Link href="/">返回公开赛程</Link>
    </main>
  );
}
