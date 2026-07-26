import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { getReviewRepository } from "@/lib/review/repository";

export default async function AdminMatchesPage() {
  await requireAdminPage("/admin/matches");
  const page = await getReviewRepository().listManualMatches();
  return (
    <main className="admin-page">
      <AdminNav />
      <h1>人工比赛</h1>
      <p><Link href="/admin/matches/new">新建人工比赛</Link></p>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>时间</th><th>游戏</th><th>赛事</th><th>对阵</th><th>可见性</th><th /></tr></thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.startTimeUtc?.toISOString() ?? "待定"}</td>
                <td>{row.game}</td>
                <td>{row.league}</td>
                <td>{row.homeTeamName} vs {row.awayTeamName}</td>
                <td>{row.hidden ? "已隐藏" : "公开"}</td>
                <td><Link href={`/admin/matches/${row.id}`}>编辑</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>共 {page.total} 场</p>
    </main>
  );
}
