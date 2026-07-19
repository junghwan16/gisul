/**
 * @file Orchestrates running suites: each case runs `trials` times, in parallel
 * up to a concurrency limit, and is scored by pass-rate.
 */

import { runClaude } from "./claude.js";
import { evaluateTrial } from "./assert.js";
import { isPlaceholder } from "./load.js";
import { DEFAULT_CONCURRENCY, DEFAULT_THRESHOLD, DEFAULT_TRIALS, HAPPY_MAX_TURNS, NEGATIVE_MAX_TURNS, RUN_TIMEOUT_MS } from "./constants.js";

/**
 * Run configuration shared across suites.
 *
 * @typedef {object} RunConfig
 * @property {number} [concurrency]
 * @property {number} [threshold]                Global green threshold (0..1).
 * @property {string} [model]                    Overrides each suite's model.
 * @property {number} [timeoutMs]
 * @property {(done: number, total: number) => void} [onProgress]
 */

/**
 * Run every case in every suite and return per-suite results.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {RunConfig} [config]
 * @returns {Promise<import('./types.js').SuiteResult[]>}
 */
export async function runSuites(suites, config = {}) {
  const results = suites.map(emptyResult);
  /** @type {Array<() => Promise<void>>} */
  const jobs = [];

  suites.forEach((suite, suiteIndex) => {
    const model = config.model ?? suite.model;
    for (const testCase of suite.cases) {
      const caseResult = blankCaseResult(testCase.id, suite.skill);
      results[suiteIndex].cases.push(caseResult);

      if (isPlaceholder(testCase.prompt)) {
        caseResult.status = "todo"; // unwritten — nothing to run
        continue;
      }
      for (const job of caseJobs(testCase, suite, model, config, caseResult)) jobs.push(job);
    }
  });

  await runPool(jobs, config.concurrency ?? DEFAULT_CONCURRENCY, config.onProgress);
  finalizeScores(suites, results, config.threshold ?? DEFAULT_THRESHOLD);
  return results;
}

/**
 * Build the trial jobs for a single case. Each job mutates `caseResult`.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {import('./types.js').Suite} suite
 * @param {string | undefined} model
 * @param {RunConfig} config
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {Array<() => Promise<void>>}
 */
function caseJobs(testCase, suite, model, config, caseResult) {
  const trials = testCase.trials ?? suite.trials ?? DEFAULT_TRIALS;
  const stopOnSkill = makeStopPredicate(testCase, suite.skill);
  const maxTurns = testCase.should_trigger ? HAPPY_MAX_TURNS : NEGATIVE_MAX_TURNS;

  return Array.from({ length: trials }, () => async () => {
    const outcome = await runClaude(testCase.prompt, {
      model,
      maxTurns,
      timeoutMs: config.timeoutMs ?? RUN_TIMEOUT_MS,
      stopOnSkill,
    });
    const checks = await evaluateTrial(testCase, suite.skill, outcome, model);
    caseResult.trials.push({ outcome, checks, pass: checks.every((check) => check.ok) });
    caseResult.costUsd += outcome.costUsd;
  });
}

/**
 * Decide when a run can stop early. Only the trigger verdict allows it — cases
 * with output checks (`match`/`absent`/`judge`) must run to completion.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {string} skill
 * @returns {(firedSkill: string) => boolean}
 */
function makeStopPredicate(testCase, skill) {
  const hasOutputChecks = (testCase.expect ?? []).some((expectation) => typeof expectation === "object");
  return (firedSkill) => {
    if (firedSkill !== skill) return false; // other skills don't affect this check
    // "must not fire" → fail fast; "should fire" (trigger-only) → pass fast
    return testCase.should_trigger ? !hasOutputChecks : true;
  };
}

/**
 * Compute each case's pass-rate and status.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {import('./types.js').SuiteResult[]} results
 * @param {number} defaultThreshold
 * @returns {void}
 */
function finalizeScores(suites, results, defaultThreshold) {
  suites.forEach((suite, suiteIndex) => {
    const threshold = suite.triggerThreshold ?? defaultThreshold;
    for (const caseResult of results[suiteIndex].cases) {
      if (caseResult.status === "todo") continue;
      const passed = caseResult.trials.filter((trial) => trial.pass).length;
      caseResult.passRate = caseResult.trials.length ? passed / caseResult.trials.length : 0;
      caseResult.status = caseResult.passRate >= threshold ? "pass" : "fail";
    }
  });
}

/**
 * Run jobs with a fixed worker pool.
 *
 * @param {Array<() => Promise<void>>} jobs
 * @param {number} size
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<void>}
 */
async function runPool(jobs, size, onProgress) {
  let nextIndex = 0;
  let done = 0;
  const worker = async () => {
    while (nextIndex < jobs.length) {
      await jobs[nextIndex++]();
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
}

/**
 * @param {import('./types.js').Suite} suite
 * @returns {import('./types.js').SuiteResult}
 */
function emptyResult(suite) {
  return { skill: suite.skill, file: suite.file ?? "", cases: [] };
}

/**
 * @param {string} id
 * @param {string} skill
 * @returns {import('./types.js').CaseResult}
 */
function blankCaseResult(id, skill) {
  return { id, skill, status: "pass", passRate: 0, trials: [], costUsd: 0 };
}
