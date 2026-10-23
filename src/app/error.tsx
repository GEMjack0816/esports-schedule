"use client";

import { AppErrorFallback } from "@/components/app-error-fallback";

export default function ErrorPage({ reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorFallback reset={reset} />;
}
