import { notFound, redirect } from "next/navigation";
import { PublishedMatchFields } from "@/components/admin-match-fields";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminAction, requireAdminPage } from "@/lib/auth/admin-page";
import { publishedFromForm } from "@/lib/review/form-data";
import {
  toggleManualMatchHidden,
  updateManualMatch,
} from "@/lib/review/service";
import { getReviewRepository } from "@/lib/review/repository";
import { ReviewConflictError } from "@/lib/review/types";

export default async function EditManualMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conflict?: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/matches/${id}`);
  const repository = getReviewRepository();
  const row = await repository.getManualMatch(id);
  if (!row) notFound();
  const conflict = (await searchParams).conflict === "1";

  async function save(form: FormData) {
    "use server";
    const session = await requireAdminAction(`/admin/matches/${id}`);
    try {
      await updateManualMatch(
        id,
        publishedFromForm(form),
        session.sub,
        form.get("expectedUpdatedAt"),
      );
    } catch (error) {
      if (error instanceof ReviewConflictError) redirect(`/admin/matches/${id}?conflict=1`);
      throw error;
    }
    redirect(`/admin/matches/${id}`);
  }

  async function toggleVisibility(form: FormData) {
    "use server";
    const session = await requireAdminAction(`/admin/matches/${id}`);
    try {
      await toggleManualMatchHidden(id, session.sub, form.get("expectedUpdatedAt"));
    } catch (error) {
      if (error instanceof ReviewConflictError) redirect(`/admin/matches/${id}?conflict=1`);
      throw error;
    }
    redirect(`/admin/matches/${id}`);
  }

  return (
    <main className="admin-page">
      <AdminNav />
      <h1>编辑人工比赛</h1>
      <p>当前：{row.hidden ? "已隐藏" : "公开"}</p>
      {conflict && <p role="alert">记录已经被其他管理员修改，请重新加载后再操作。</p>}
      <form action={save} className="admin-edit-form">
        <input type="hidden" name="expectedUpdatedAt" value={row.updatedAt.toISOString()} />
        <PublishedMatchFields value={row} />
        <button className="admin-primary" type="submit">保存并刷新公开赛程</button>
      </form>
      <form action={toggleVisibility}>
        <input type="hidden" name="expectedUpdatedAt" value={row.updatedAt.toISOString()} />
        <button type="submit">{row.hidden ? "恢复公开" : "隐藏比赛"}</button>
      </form>
    </main>
  );
}
