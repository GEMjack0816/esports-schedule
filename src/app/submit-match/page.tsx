import type { Metadata } from "next";
import { SubmitMatchForm } from "@/components/submit-match-form";

export const metadata: Metadata = {
  title: "提交遗漏比赛｜赛界 PULSE",
  description: "提交遗漏的电竞比赛，审核通过后补充到赛程。",
  alternates: {
    canonical: "/submit-match",
  },
  openGraph: {
    title: "提交遗漏比赛｜赛界 PULSE",
    description: "提交遗漏的电竞比赛，审核通过后补充到赛程。",
    url: "https://esports-schedule-two.vercel.app/submit-match",
    type: "website",
    locale: "zh_CN",
  },
};

export default function SubmitMatchPage() {
  return <SubmitMatchForm />;
}
