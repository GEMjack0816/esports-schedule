"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  getSubmissionButtonState,
  requestMatchSubmission,
  retrySecondsRemaining,
} from "@/lib/submission-client";

type SubmitState = { kind: "idle" | "success" | "info" | "error"; message: string };

export function SubmitMatchForm() {
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<SubmitState>({ kind: "idle", message: "" });
  const submissionInFlight = useRef(false);
  const [retryWindow, setRetryWindow] = useState<{ deadline: number; now: number } | null>(null);
  const retryDeadline = retryWindow?.deadline ?? null;
  const retryCountdown = retryWindow
    ? retrySecondsRemaining(retryWindow.deadline, retryWindow.now)
    : 0;
  const submitButton = getSubmissionButtonState(submitting, retryCountdown);

  useEffect(() => {
    if (retryDeadline === null) return;

    const updateClock = () => {
      const now = Date.now();
      setRetryWindow((current) => {
        if (!current || current.deadline !== retryDeadline) return current;
        return retrySecondsRemaining(current.deadline, now) === 0
          ? null
          : { ...current, now };
      });
    };
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, [retryDeadline]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    setState({ kind: "idle", message: "" });
    const form = event.currentTarget;
    const values = new FormData(form);

    try {
      const localTime = String(values.get("scheduledAt") || "");
      const result = await requestMatchSubmission({
        game: values.get("game"),
        league: values.get("league"),
        teamA: values.get("teamA"),
        teamB: values.get("teamB"),
        scheduledAt: new Date(localTime).toISOString(),
        bestOf: values.get("bestOf") ? Number(values.get("bestOf")) : null,
        sourceUrl: values.get("sourceUrl"),
        notes: values.get("notes"),
        website: values.get("website"),
      });
      if (!result.ok) {
        if (result.retryAfterSeconds) {
          const now = Date.now();
          setRetryWindow({ deadline: now + result.retryAfterSeconds * 1_000, now });
        }
        setState({ kind: "error", message: result.message });
        return;
      }
      if (result.alreadyListed) {
        setState({ kind: "info", message: result.message });
        return;
      }
      setState({ kind: "success", message: result.message });
      form.reset();
    } catch {
      setState({
        kind: "error",
        message: "请检查比赛时间后重试。",
      });
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="submit-page">
      <div className="submit-heading">
        <Link href="/" className="back-link" prefetch={false}>← 返回赛程</Link>
        <span className="section-index">02 / 社区补录</span>
        <h1>提交遗漏比赛</h1>
        <p>请提供可核验的来源链接。提交内容只会进入待审核队列，审核通过前不会显示在公开赛程中。</p>
      </div>

      <form className="submit-form" onSubmit={submit} aria-busy={submitting}>
        <label>
          <span>游戏</span>
          <select name="game" required defaultValue="lol">
            <option value="lol">英雄联盟</option>
            <option value="valorant">无畏契约</option>
            <option value="honor-of-kings">王者荣耀</option>
            <option value="cs2">CS2</option>
            <option value="dota2">Dota 2</option>
          </select>
        </label>
        <label>
          <span>赛事</span>
          <input name="league" required maxLength={120} placeholder="例如：LPL 夏季赛" />
        </label>
        <label>
          <span>战队 A</span>
          <input name="teamA" required maxLength={80} placeholder="尚未确定可填写：待定" />
        </label>
        <label>
          <span>战队 B</span>
          <input name="teamB" required maxLength={80} placeholder="尚未确定可填写：待定" />
        </label>
        <label>
          <span>比赛时间（你的本地时区）</span>
          <input name="scheduledAt" type="datetime-local" required />
        </label>
        <label>
          <span>赛制</span>
          <select name="bestOf" defaultValue="">
            <option value="">未知</option>
            <option value="1">BO1</option>
            <option value="3">BO3</option>
            <option value="5">BO5</option>
            <option value="7">BO7</option>
          </select>
        </label>
        <label className="submit-wide">
          <span>来源链接</span>
          <input name="sourceUrl" type="url" required maxLength={500} placeholder="https://…" />
        </label>
        <label className="submit-wide">
          <span>补充说明（选填）</span>
          <textarea name="notes" maxLength={1000} rows={4} />
        </label>
        <label className="submission-honeypot" aria-hidden="true">
          <span>Website</span>
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
        <div className="submit-actions submit-wide">
          <button type="submit" disabled={submitButton.disabled}>
            {submitButton.label}
          </button>
          {state.kind !== "idle" && (
            <p className={`submit-message ${state.kind}`} role="status">{state.message}</p>
          )}
        </div>
      </form>
    </main>
  );
}
