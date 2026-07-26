import { redirect } from "next/navigation";
import { PublishedMatchFields } from "@/components/admin-match-fields";
import { AdminNav } from "@/components/admin-nav";
import { requireAdminPage } from "@/lib/auth/admin-page";
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
  const session = await requireAdminPage("/admin/matches/new");

  async function create(form: FormData) {
    "use server";
    const row = await createManualMatch(publishedFromForm(form), session.sub);
    redirect(`/admin/matches/${row.id}`);
  }

  return (
    <main className="admin-page">
      <AdminNav />
      <h1>新建人工比赛</h1>
      <form action={create} className="admin-edit-form">
        <PublishedMatchFields value={blank} />
        <button className="admin-primary" type="submit">发布比赛</button>
      </form>
    </main>
  );
}
