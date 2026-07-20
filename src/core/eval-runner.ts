/**
 * Orchestrates running suites: each case runs `trials` times, in parallel up
 * to a concurrency limit, and is scored by pass-rate. Depends only on the
 * {@link AgentRunner} port, so scoring/threshold/early-stop behaviour is
 * testable with a fake runner.
 */

import type { AgentRunner } from "../agent/agent-runner.js";
import { createJudge } from "../agent/judge.js";
import { evaluateTrial } from "./checks.js";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_THRESHOLD,
  DEFAULT_TRIALS,
  HAPPY_MAX_TURNS,
  NEGATIVE_MAX_TURNS,
  RUN_TIMEOUT_MS,
} from "./constants.js";
import { resolveCwd } from "../suite/cwd.js";
import { hasOutputChecks, isUnwritten } from "./test-case.js";
import type { CaseResult, Suite, SuiteResult, TestCase } from "./types.js";
import { runPool, type Job, type ProgressFn } from "../shared/pool.js";

/** Run configuration shared across suites. */
export interface RunConfig {
  concurrency?: number;
  /** Global green threshold (0..1). */
  threshold?: number;
  /** Overrides each suite's model. */
  model?: string;
  /** Overrides each suite's/case's trials. */
  trials?: number;
  timeoutMs?: number;
  /**
   * Run every case inside this materialized project (see `suite/isolate.ts`)
   * with discovery restricted to it. Callers must reject suites that declare
   * their own `cwd` first — isolation pins the working directory.
   */
  isolation?: { cwd: string };
  onProgress?: ProgressFn;
}

/** Run every case in every suite and return per-suite results. */
export async function runSuites(
  suites: Suite[],
  runner: AgentRunner,
  config: RunConfig = {},
): Promise<SuiteResult[]> {
  const defaultThreshold = config.threshold ?? DEFAULT_THRESHOLD;
  const results = suites.map((suite) => emptyResult(suite, defaultThreshold));
  const jobs: Job[] = [];

  suites.forEach((suite, suiteIndex) => {
    const model = config.model ?? suite.model;
    for (const testCase of suite.cases) {
      const caseResult = blankCaseResult(testCase.id, suite.skill);
      results[suiteIndex]!.cases.push(caseResult);

      if (isUnwritten(testCase)) {
        caseResult.status = "todo"; // unwritten — nothing to run
        continue;
      }
      jobs.push(
        ...caseJobs(testCase, suite, model, runner, config, caseResult),
      );
    }
  });

  await runPool(
    jobs,
    config.concurrency ?? DEFAULT_CONCURRENCY,
    config.onProgress,
  );
  finalizeScores(results);
  return results;
}

/** Build the trial jobs for a single case. Each job mutates `caseResult`. */
function caseJobs(
  testCase: TestCase,
  suite: Suite,
  model: string | undefined,
  runner: AgentRunner,
  config: RunConfig,
  caseResult: CaseResult,
): Job[] {
  // A CLI `--trials` overrides everything; otherwise per-case beats per-suite.
  const trials =
    config.trials ?? testCase.trials ?? suite.trials ?? DEFAULT_TRIALS;
  const stopOnSkill = makeStopPredicate(testCase, suite.skill);
  const maxTurns = testCase.should_trigger
    ? HAPPY_MAX_TURNS
    : NEGATIVE_MAX_TURNS;
  const cwd = config.isolation?.cwd ?? resolveCwd(suite, testCase);
  const judge = createJudge(runner, model);

  return Array.from({ length: trials }, () => async () => {
    const outcome = await runner.run(testCase.prompt, {
      model,
      maxTurns,
      timeoutMs: config.timeoutMs ?? RUN_TIMEOUT_MS,
      cwd,
      isolate: config.isolation ? true : undefined,
      stopOnSkill,
    });
    const checks = await evaluateTrial(testCase, suite.skill, outcome, judge);
    caseResult.trials.push({
      outcome,
      checks,
      pass: checks.every((check) => check.ok),
    });
    caseResult.costUsd += outcome.costUsd;
  });
}

/**
 * Decide when a run can stop early — only once the trigger verdict is settled.
 * Cases with output checks must run to completion.
 */
export function makeStopPredicate(
  testCase: TestCase,
  skill: string,
): (firedSkill: string) => boolean {
  // "no skill may fire": any skill firing settles the verdict (fail fast).
  if (testCase.expect_skill === "none") return () => true;
  const runToCompletion = testCase.should_trigger && hasOutputChecks(testCase);
  return (firedSkill) => {
    // A sibling firing settles nothing — the target could still fire later.
    if (firedSkill !== skill) return false;
    // target fired: "must not fire" → fail fast; trigger-only → pass fast
    return !runToCompletion;
  };
}

/** Compute each case's passed count, pass-rate, and status. */
function finalizeScores(results: SuiteResult[]): void {
  for (const suiteResult of results) {
    for (const caseResult of suiteResult.cases) {
      if (caseResult.status === "todo") continue;
      caseResult.passed = caseResult.trials.filter(
        (trial) => trial.pass,
      ).length;
      caseResult.passRate = caseResult.trials.length
        ? caseResult.passed / caseResult.trials.length
        : 0;
      caseResult.status =
        caseResult.passRate >= suiteResult.threshold ? "pass" : "fail";
    }
  }
}

function emptyResult(suite: Suite, defaultThreshold: number): SuiteResult {
  return {
    skill: suite.skill,
    file: suite.file ?? "",
    threshold: suite.triggerThreshold ?? defaultThreshold,
    cases: [],
  };
}

function blankCaseResult(id: string, skill: string): CaseResult {
  return {
    id,
    skill,
    status: "pass",
    passRate: 0,
    passed: 0,
    trials: [],
    costUsd: 0,
  };
}
