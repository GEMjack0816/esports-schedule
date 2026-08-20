import { notFound, redirect } from "next/navigation";
import { PublishedMatchFields, SubmissionFields } from "@/components/admin-match-fields";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminAction, requireAdminPage } from "@/lib/auth/admin-page";
import { publishedFromForm, submissionFromForm } from "@/lib/review/form-data";
import { getReviewRepository } from "@/lib/review/repository";
import {
  approveAndPublish,
  defaultPublishedFromSubmission,
  validateRejectionReason,
} from "@/lib/review/service";
import { validateSubmission } from "@/lib/submissions";
import type { MatchSubmissionInput } from "@/lib/submissions";
import type { GameKey } from "@/lib/schedule";

export default async function SubmissionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/submissions/${id}`);
  const repository = getReviewRepository();
  const row = await repository.getSubmission(id);
  if (!row) notFound();
  const submissionInput: MatchSubmissionInput = {
    game: row.game as GameKey,
    league: row.league,
    teamA: row.teamA,
    teamB: row.teamB,
    scheduledAt: row.scheduledAt.toISOString(),
    bestOf: row.bestOf,
    sourceUrl: row.sourceUrl,
    notes: row.notes,
  };

  async function save(form: FormData) {
    "use server";
    const session = await requireAdminAction(`/admin/submissions/${id}`);
    await getReviewRepository().saveSubmission(
      id,
      validateSubmission(submissionFromForm(form)),
      session.sub,
    );
    redirect(`/admin/submissions/${id}`);
  }

  async function approve(form: FormData) {
    "use server";
    const session = await requireAdminAction(`/admin/submissions/${id}`);
    await approveAndPublish(id, {
      submission: submissionFromForm(form),
      published: publishedFromForm(form),
    }, session.sub);
    redirect("/admin/submissions?status=approved");
  }

  async function reject(form: FormData) {
    "use server";
    const session = await requireAdminAction(`/admin/submissions/${id}`);
    await getReviewRepository().rejectSubmission(
      id,
      validateRejectionReason(form.get("rejectionReason")),
      session.sub,
    );
    redirect("/admin/submissions?status=rejected");
  }

  return (
    <main className="admin-page">
      <AdminNav />
      <h1>审核提交</h1>
      <p>状态：{row.status} · 提交于 {row.submittedAt.toISOString()}</p>
      <form className="admin-edit-form">
        <SubmissionFields row={row} />
        <PublishedMatchFields value={defaultPublishedFromSubmission(submissionInput)} />
        {row.status === "pending" && (
          <div className="admin-actions">
            <button formAction={save}>保存修改</button>
            <button className="admin-primary" formAction={approve}>批准并发布</button>
          </div>
        )}
      </form>
      {row.status === "pending" && (
        <form action={reject} className="admin-reject">
          <label>驳回原因<textarea name="rejectionReason" required maxLength={500} /></label>
          <button type="submit">驳回</button>
        </form>
      )}
    </main>
  );
}
