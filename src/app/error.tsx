"use client";

import { AppErrorFallback } from "@/components/app-error-fallback";

export default function ErrorPage({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <AppErrorFallback retry={retry} />;
}
