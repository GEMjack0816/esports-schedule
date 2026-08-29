import Link from "next/link";

export function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="管理员导航">
      <Link href="/admin">概览</Link>
      <Link href="/admin/submissions">待审核提交</Link>
      <Link href="/admin/matches">人工比赛</Link>
      <Link href="/admin/matches/new">新建比赛</Link>
      <form action="/api/auth/signout" method="post">
        <button type="submit">退出</button>
      </form>
    </nav>
  );
}
