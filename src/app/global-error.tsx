"use client";

import { AppErrorFallback } from "@/components/app-error-fallback";
import styles from "@/components/app-error-fallback.module.css";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-bootstrap";

export default function GlobalError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={styles.globalBody}>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
        <AppErrorFallback retry={retry} />
      </body>
    </html>
  );
}
