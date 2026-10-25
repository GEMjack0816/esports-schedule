export default function AdminLoading() {
  return (
    <>
      <p id="admin-loading-status" className="sr-only" role="status" aria-live="polite">
        正在加载管理页面…
      </p>
      <main className="admin-page" aria-busy="true" aria-describedby="admin-loading-status">
        <div aria-hidden="true">
          <span className="loading-skeleton loading-heading-title" />
          <div className="admin-stats loading-admin-stats">
            {Array.from({ length: 5 }, (_, index) => (
              <article key={index}>
                <span className="loading-skeleton loading-stat-value" />
                <span className="loading-skeleton loading-stat-label" />
              </article>
            ))}
          </div>
          <div className="loading-admin-list">
            {Array.from({ length: 3 }, (_, index) => (
              <span className="loading-skeleton loading-admin-row" key={index} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
