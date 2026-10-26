import type { ReactNode } from "react";

type ScheduleResultsPanelProps = {
  children: ReactNode;
  completeScheduleError: boolean;
  loadingCompleteSchedule: boolean;
  needsCompleteSchedule: boolean;
  onRetry: () => void;
};

/** Keep the currently available matches visible while a full schedule loads or retries. */
export function ScheduleResultsPanel({
  children,
  completeScheduleError,
  loadingCompleteSchedule,
  needsCompleteSchedule,
  onRetry,
}: ScheduleResultsPanelProps) {
  const isLoading = loadingCompleteSchedule && needsCompleteSchedule;
  const hasError = completeScheduleError && needsCompleteSchedule;

  return (
    <>
      {isLoading && (
        <div className="data-notice" role="status">
          <span>正在加载完整赛程；先显示当前已加载的比赛。</span>
        </div>
      )}
      {hasError && (
        <div className="data-notice">
          <span role="alert">完整赛程暂时无法加载；当前已加载的比赛仍可查看。</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}
      <div className="match-list" aria-live="polite" aria-busy={isLoading}>
        {children}
      </div>
    </>
  );
}
