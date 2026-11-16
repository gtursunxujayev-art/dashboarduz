/**
 * The start/stop loop shared by the background schedulers (Telegram reports, amoCRM call sync,
 * bonus auto-finalize, webhook-event retention).
 */
export type IntervalJob = {
  /** Runs once now, then every `intervalMs`. Calling it again while started does nothing. */
  start(): void;
  /** Clears the interval so nothing keeps the process alive. A run in progress finishes. */
  stop(): void;
  /** One run, with the same overlap guard and error handling as the timer uses. */
  runOnce(): Promise<void>;
  isStarted(): boolean;
};

export type IntervalJobOptions = {
  intervalMs: number;
  run: () => Promise<unknown>;
  /** Called with whatever `run` threw; the loop keeps going. */
  onError: (error: unknown) => void;
  /** Skip a tick while the previous run is still in progress (the Telegram report schedulers). */
  skipWhileRunning?: boolean;
  /** Called after the first run has been kicked off, e.g. to log that the scheduler started. */
  onStart?: () => void;
};

export function createIntervalJob(options: IntervalJobOptions): IntervalJob {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runOnce(): Promise<void> {
    if (options.skipWhileRunning && running) {
      return;
    }
    running = true;

    try {
      await options.run();
    } catch (error) {
      options.onError(error);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) {
        return;
      }
      void runOnce();
      timer = setInterval(() => {
        void runOnce();
      }, options.intervalMs);
      options.onStart?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runOnce,
    isStarted: () => timer !== null,
  };
}
