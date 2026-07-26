import { notFound, redirect } from "next/navigation";
import { PublishedMatchFields } from "@/components/admin-match-fields";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { publishedFromForm } from "@/lib/review/form-data";
import {
  setManualMatchHidden,
  updateManualMatch,
} from "@/lib/review/service";
import { getReviewRepository } from "@/lib/review/repository";

export default async function EditManualMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAdminPage(`/admin/matches/${id}`);
  const repository = getReviewRepository();
  const row = await repository.getManualMatch(id);
  if (!row) notFound();
  const isHidden = row.hidden;

  async function save(form: FormData) {
    "use server";
    await updateManualMatch(id, publishedFromForm(form), session.sub, repository);
    redirect(`/admin/matches/${id}`);
  }

  async function toggleVisibility() {
    "use server";
    await setManualMatchHidden(id, !isHidden, session.sub, repository);
    redirect(`/admin/matches/${id}`);
  }

  return (
    <main className="admin-page">
      <AdminNav />
      <h1>编辑人工比赛</h1>
      <p>当前：{row.hidden ? "已隐藏" : "公开"}</p>
      <form action={save} className="admin-edit-form">
        <PublishedMatchFields value={row} />
        <button className="admin-primary" type="submit">保存并刷新公开赛程</button>
      </form>
      <form action={toggleVisibility}>
        <button type="submit">{row.hidden ? "恢复公开" : "隐藏比赛"}</button>
      </form>
    </main>
  );
}
