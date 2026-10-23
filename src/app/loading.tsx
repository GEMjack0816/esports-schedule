export default function Loading() {
  return (
    <main className="site-shell schedule-loading" aria-busy="true" aria-describedby="schedule-loading-status">
      <p id="schedule-loading-status" className="sr-only" role="status" aria-live="polite">
        正在加载赛程…
      </p>

      <header className="site-header" aria-hidden="true">
        <div className="loading-brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>ESPORTS <span className="brand-accent">SCHEDULE</span></span>
        </div>
        <span className="loading-skeleton loading-header-action" />
      </header>

      <section className="hero-section loading-hero" aria-hidden="true">
        <div className="loading-copy">
          <span className="loading-skeleton loading-eyebrow" />
          <span className="loading-skeleton loading-title" />
          <span className="loading-skeleton loading-description" />
          <span className="loading-skeleton loading-description loading-description-short" />
        </div>
        <div className="hero-stats loading-stats">
          <div className="loading-stat"><span className="loading-skeleton loading-stat-label" /><span className="loading-skeleton loading-stat-value" /><span className="loading-skeleton loading-stat-caption" /></div>
          <div className="loading-stat"><span className="loading-skeleton loading-stat-label" /><span className="loading-skeleton loading-stat-value" /><span className="loading-skeleton loading-stat-caption" /></div>
        </div>
      </section>

      <section className="schedule-section" aria-hidden="true">
        <div className="section-heading loading-heading">
          <div><span className="loading-skeleton loading-heading-kicker" /><span className="loading-skeleton loading-heading-title" /></div>
          <span className="loading-skeleton loading-data-state" />
        </div>
        <div className="loading-sync-grid">
          {Array.from({ length: 5 }, (_, index) => <span className="loading-skeleton loading-sync-card" key={index} />)}
        </div>
        <div className="loading-tabs">
          {Array.from({ length: 5 }, (_, index) => <span className="loading-skeleton loading-tab" key={index} />)}
        </div>
        <div className="loading-filters">
          {Array.from({ length: 5 }, (_, index) => <span className="loading-skeleton loading-filter" key={index} />)}
        </div>
        <div className="loading-match-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="loading-match" key={index}>
              <span className="loading-skeleton loading-match-time" />
              <span className="loading-skeleton loading-match-event" />
              <span className="loading-skeleton loading-match-teams" />
              <span className="loading-skeleton loading-match-meta" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
