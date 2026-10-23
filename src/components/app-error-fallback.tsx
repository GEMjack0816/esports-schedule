import type { ReactElement } from "react";
import Link from "next/link";
import styles from "./app-error-fallback.module.css";

export function AppErrorFallback({ retry }: { retry: () => void }): ReactElement {
  return (
    <main className={styles.shell} aria-labelledby="app-error-title" aria-describedby="app-error-description">
      <section className={styles.card} role="alert">
        <p className={styles.eyebrow}>赛界 PULSE · 页面恢复</p>
        <h1 id="app-error-title" className={styles.title}>页面暂时无法显示</h1>
        <p id="app-error-description" className={styles.description}>
          刚才的页面遇到了一点问题。可以安全重试，或返回首页继续查看赛程。
        </p>
        <div className={styles.actions}>
          <button className={styles.primary} type="button" onClick={retry}>
            重试
          </button>
          <Link className={styles.secondary} href="/">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
