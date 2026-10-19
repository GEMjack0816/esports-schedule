import type { MatchSubmissionRow, PublishedManualMatchRow } from "@/db/schema";
import type { PublishedMatchWrite } from "@/lib/review/types";
import { utcDateTimeLocalValue } from "@/lib/review/utc-datetime-input";

export function SubmissionFields({ row }: { row: MatchSubmissionRow }) {
  return (
    <fieldset>
      <legend>提交内容</legend>
      <label>游戏<input name="submission.game" defaultValue={row.game} required /></label>
      <label>赛事<input name="submission.league" defaultValue={row.league} required /></label>
      <label>战队 A<input name="submission.teamA" defaultValue={row.teamA} required /></label>
      <label>战队 B<input name="submission.teamB" defaultValue={row.teamB} required /></label>
      <label>开始时间（UTC）<input name="submission.scheduledAt" type="datetime-local" step="0.001" defaultValue={utcDateTimeLocalValue(row.scheduledAt)} required /></label>
      <label>BO<input name="submission.bestOf" type="number" min="1" max="9" defaultValue={row.bestOf ?? ""} /></label>
      <label>来源<input name="submission.sourceUrl" type="url" defaultValue={row.sourceUrl} required /></label>
      <label>备注<textarea name="submission.notes" defaultValue={row.notes ?? ""} /></label>
    </fieldset>
  );
}

export function PublishedMatchFields({
  value,
}: {
  value: PublishedManualMatchRow | PublishedMatchWrite;
}) {
  return (
    <fieldset>
      <legend>公开比赛</legend>
      <label>游戏<input name="published.game" defaultValue={value.game} required /></label>
      <label>赛事<input name="published.league" defaultValue={value.league} required /></label>
      <label>系列赛<input name="published.tournament" defaultValue={value.tournament ?? ""} /></label>
      <label>阶段<input name="published.stage" defaultValue={value.stage ?? ""} /></label>
      <label>主队<input name="published.homeTeamName" defaultValue={value.homeTeamName} required /></label>
      <label>主队简称<input name="published.homeTeamAcronym" defaultValue={value.homeTeamAcronym ?? ""} /></label>
      <label>主队 Logo<input name="published.homeTeamLogo" type="url" defaultValue={value.homeTeamLogo ?? ""} /></label>
      <label>客队<input name="published.awayTeamName" defaultValue={value.awayTeamName} required /></label>
      <label>客队简称<input name="published.awayTeamAcronym" defaultValue={value.awayTeamAcronym ?? ""} /></label>
      <label>客队 Logo<input name="published.awayTeamLogo" type="url" defaultValue={value.awayTeamLogo ?? ""} /></label>
      <label>开始时间（UTC）<input name="published.startTimeUtc" type="datetime-local" step="0.001" defaultValue={utcDateTimeLocalValue(value.startTimeUtc)} /></label>
      <label>BO<input name="published.bestOf" type="number" min="1" max="9" defaultValue={value.bestOf ?? ""} /></label>
      <label>状态<select name="published.status" defaultValue={value.status}>
        {["scheduled", "running", "finished", "postponed", "cancelled", "forfeit", "unknown"].map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select></label>
      <label>主队比分<input name="published.homeScore" type="number" min="0" defaultValue={value.homeScore ?? ""} /></label>
      <label>客队比分<input name="published.awayScore" type="number" min="0" defaultValue={value.awayScore ?? ""} /></label>
      <label>直播链接<input name="published.streamUrl" type="url" defaultValue={value.streamUrl ?? ""} /></label>
      <label>来源链接<input name="published.sourceUrl" type="url" defaultValue={value.sourceUrl ?? ""} /></label>
    </fieldset>
  );
}
