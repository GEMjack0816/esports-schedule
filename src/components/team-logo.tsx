"use client";

import Image from "next/image";
import { useState } from "react";
import { recoverTeamLogo, TEAM_LOGO_PLACEHOLDER } from "@/lib/schedule/team-logo";

export function TeamLogo({ source }: { source: string }) {
  const primarySource = source || TEAM_LOGO_PLACEHOLDER;
  const [recovery, setRecovery] = useState<{ source: string; src: string; retried: boolean } | null>(null);
  const currentRecovery = recovery?.source === primarySource ? recovery : null;
  const displaySource = currentRecovery?.src ?? primarySource;

  function handleError() {
    if (displaySource === TEAM_LOGO_PLACEHOLDER) return;

    const next = recoverTeamLogo(primarySource, currentRecovery?.retried ?? false);
    setRecovery({ source: primarySource, src: next.src, retried: next.kind === "retry" });
  }

  return (
    <Image
      key={displaySource}
      src={displaySource}
      alt=""
      width={28}
      height={28}
      unoptimized
      onError={handleError}
    />
  );
}
