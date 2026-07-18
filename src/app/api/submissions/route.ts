import { savePendingSubmission } from "@/lib/submissions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 10_000) {
      return Response.json({ ok: false, error: "提交内容过大" }, { status: 413 });
    }
    const submission = await savePendingSubmission(JSON.parse(body));
    return Response.json({
      ok: true,
      id: submission.id,
      status: submission.status,
      message: "已保存为待审核，审核通过前不会公开。",
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
