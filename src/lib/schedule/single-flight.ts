export type SingleFlight<T> = {
  run: (operation: () => Promise<T>) => Promise<T>;
  isRunning: () => boolean;
};

/** Reuses one promise for all concurrent callers in the same function instance. */
export function createSingleFlight<T>(): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;
  return {
    run(operation) {
      if (inFlight) return inFlight;
      inFlight = operation().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    isRunning() {
      return inFlight !== null;
    },
  };
}
