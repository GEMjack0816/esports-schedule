import type { Metadata } from "next";
import { SubmitMatchForm } from "@/components/submit-match-form";

export const metadata: Metadata = {
  title: "提交遗漏比赛｜赛界 PULSE",
  description: "提交遗漏的电竞比赛，审核通过后补充到赛程。",
};

export default function SubmitMatchPage() {
  return <SubmitMatchForm />;
}
