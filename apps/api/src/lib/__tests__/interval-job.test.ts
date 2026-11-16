import { createIntervalJob } from '../interval-job';

describe('createIntervalJob', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs immediately, then on every interval, until stopped', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const onStart = jest.fn();
    const job = createIntervalJob({ intervalMs: 1000, run, onError: jest.fn(), onStart });

    job.start();
    job.start();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(job.isStarted()).toBe(true);

    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);

    job.stop();
    expect(job.isStarted()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('passes errors to onError and keeps going', async () => {
    const error = new Error('boom');
    const run = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = jest.fn();
    const job = createIntervalJob({ intervalMs: 1000, run, onError });

    await job.runOnce();
    await job.runOnce();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('skips overlapping runs only when skipWhileRunning is set', async () => {
    let release: () => void = () => undefined;
    const slow = () => new Promise<void>((resolve) => { release = resolve; });

    const guarded = jest.fn(slow);
    const guardedJob = createIntervalJob({ intervalMs: 1000, run: guarded, onError: jest.fn(), skipWhileRunning: true });
    const first = guardedJob.runOnce();

    await guardedJob.runOnce();
    expect(guarded).toHaveBeenCalledTimes(1);
    release();
    await first;

    const unguarded = jest.fn(slow);
    const unguardedJob = createIntervalJob({ intervalMs: 1000, run: unguarded, onError: jest.fn() });

    void unguardedJob.runOnce();
    void unguardedJob.runOnce();
    expect(unguarded).toHaveBeenCalledTimes(2);
    release();
  });
});
