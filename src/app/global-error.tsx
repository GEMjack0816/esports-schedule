"use client";

import { AppErrorFallback } from "@/components/app-error-fallback";
import styles from "@/components/app-error-fallback.module.css";

export default function GlobalError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className={styles.globalBody}>
        <AppErrorFallback retry={retry} />
      </body>
    </html>
  );
}
