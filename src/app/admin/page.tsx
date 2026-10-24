import { AdminNav } from "@/components/admin-nav";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { getReviewRepository } from "@/lib/review/repository";

export default async function AdminDashboardPage() {
  await requireAdminPage("/admin");
  const summary = await getReviewRepository().getSummary();
  return (
    <main className="admin-page">
      <AdminNav />
      <h1>审核概览</h1>
      <div className="admin-stats">
        <article><strong>{summary.pending}</strong><span>待审核</span></article>
        <article><strong>{summary.today}</strong><span>今日提交</span></article>
        <article><strong>{summary.approved}</strong><span>已批准</span></article>
        <article><strong>{summary.rejected}</strong><span>已驳回</span></article>
        <article><strong>{summary.publishedManualMatches}</strong><span>已发布人工比赛</span></article>
      </div>
      <h2>最近操作</h2>
      <ul>
        {summary.recentEvents.map((event) => (
          <li key={event.id}>
            {event.action} · {event.entityType} · {event.createdAt.toISOString()}
          </li>
        ))}
      </ul>
    </main>
  );
}
