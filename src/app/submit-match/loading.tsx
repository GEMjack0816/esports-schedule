export default function SubmitMatchLoading() {
  return (
    <>
      <p id="submit-match-loading-status" className="sr-only" role="status" aria-live="polite">
        正在加载提交表单…
      </p>
      <main
        className="submit-page"
        aria-busy="true"
        aria-describedby="submit-match-loading-status"
      >
        <section className="submit-heading" aria-hidden="true">
          <span className="loading-skeleton loading-heading-kicker" />
          <span className="loading-skeleton loading-title" />
          <span className="loading-skeleton loading-description" />
          <span className="loading-skeleton loading-description loading-description-short" />
        </section>
        <div className="submit-form loading-submit-form" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="loading-submit-field" key={index}>
              <span className="loading-skeleton loading-field-label" />
              <span className="loading-skeleton loading-field-control" />
            </div>
          ))}
          <div className="loading-submit-field loading-submit-field-wide">
            <span className="loading-skeleton loading-field-label" />
            <span className="loading-skeleton loading-field-control" />
          </div>
          <span className="loading-skeleton loading-submit-action" />
        </div>
      </main>
    </>
  );
}
