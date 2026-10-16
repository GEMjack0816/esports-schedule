import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { AdminSubmissionFilters } from "@/components/admin-submission-filters";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { getReviewRepository } from "@/lib/review/repository";
import { parseSubmissionFilters } from "@/lib/review/service";

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("/admin/submissions");
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }
  const page = await getReviewRepository().listSubmissions(parseSubmissionFilters(params));
  return (
    <main className="admin-page">
      <AdminNav />
      <h1>比赛提交</h1>
      <AdminSubmissionFilters
        status={params.get("status") ?? ""}
        query={params.get("q") ?? ""}
      />
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>提交时间</th><th>游戏</th><th>赛事</th><th>对阵</th><th>状态</th><th /></tr></thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.submittedAt.toISOString()}</td>
                <td>{row.game}</td>
                <td>{row.league}</td>
                <td>{row.teamA} vs {row.teamB}</td>
                <td>{row.status}</td>
                <td><Link href={`/admin/submissions/${row.id}`}>查看</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>共 {page.total} 条</p>
    </main>
  );
}
