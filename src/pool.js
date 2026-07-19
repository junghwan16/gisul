/**
 * @file A fixed-size worker pool for async jobs, shared by the eval runner and
 * the bench runner.
 */

/**
 * Run jobs with a fixed worker pool.
 *
 * @param {Array<() => Promise<void>>} jobs
 * @param {number} size
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<void>}
 */
export async function runPool(jobs, size, onProgress) {
  let nextIndex = 0;
  let done = 0;
  const worker = async () => {
    while (nextIndex < jobs.length) {
      await jobs[nextIndex++]();
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, worker),
  );
}
