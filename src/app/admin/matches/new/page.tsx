import { redirect } from "next/navigation";
import { PublishedMatchFields } from "@/components/admin-match-fields";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminAction, requireAdminPage } from "@/lib/auth/admin-page";
import { publishedFromForm } from "@/lib/review/form-data";
import { createManualMatch } from "@/lib/review/service";
import type { PublishedMatchWrite } from "@/lib/review/types";

const blank: PublishedMatchWrite = {
  game: "lol",
  league: "",
  tournament: null,
  stage: null,
  homeTeamName: "",
  homeTeamAcronym: null,
  homeTeamLogo: null,
  awayTeamName: "",
  awayTeamAcronym: null,
  awayTeamLogo: null,
  startTimeUtc: null,
  bestOf: null,
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  streamUrl: null,
  sourceUrl: null,
};

export default async function NewManualMatchPage() {
  await requireAdminPage("/admin/matches/new");
  const operationKey = crypto.randomUUID();

  async function create(form: FormData) {
    "use server";
    const session = await requireAdminAction("/admin/matches/new");
    const row = await createManualMatch(
      publishedFromForm(form),
      session.sub,
      form.get("operationKey"),
    );
    redirect(`/admin/matches/${row.id}`);
  }

  return (
    <main className="admin-page">
      <AdminNav />
      <h1>新建人工比赛</h1>
      <form action={create} className="admin-edit-form">
        <input type="hidden" name="operationKey" value={operationKey} />
        <PublishedMatchFields value={blank} />
        <button className="admin-primary" type="submit">发布比赛</button>
      </form>
    </main>
  );
}
