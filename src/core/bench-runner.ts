/**
 * The A/B runner: each benchable case runs the same prompt with the skill
 * available and without it, grades both outputs on the case's output checks,
 * and reports the lift. The "without" arm blocks all skills by default
 * (`--disallowedTools Skill`); with `isolation` set it instead runs in a
 * materialized project missing only the target skill — per-skill ablation.
 *
 * Only happy cases with output checks (`match` / `absent` / `judge`) are
 * benchable — a trigger-only case has nothing to compare, and a "must not
 * fire" case is identical in both arms. Both arms run interleaved in the same
 * pool so time-of-day and model drift hit them equally.
 */

import type { AgentRunner } from "../agent/agent-runner.js";
import { createJudge, type Judge } from "../agent/judge.js";
import { evaluateOutputChecks } from "./checks.js";
import {
  BENCH_TRIALS,
  DEFAULT_CONCURRENCY,
  HAPPY_MAX_TURNS,
  RUN_TIMEOUT_MS,
} from "./constants.js";
import { resolveCwd } from "../suite/cwd.js";
import { isBenchable, isUnwritten } from "./test-case.js";
import type { Suite, TestCase } from "./types.js";
import { runPool, type Job, type ProgressFn } from "../shared/pool.js";

/** The two materialized projects an isolated A/B runs in. */
export interface ArmProjects {
  /** Project holding every skill, including the target. */
  withCwd: string;
  /** Project holding every skill except the target — true per-skill ablation. */
  withoutCwd: string;
}

/** Bench configuration. */
export interface BenchConfig {
  /** Trials per arm (default {@link BENCH_TRIALS}). */
  trials?: number;
  concurrency?: number;
  /** Overrides each suite's model. */
  model?: string;
  timeoutMs?: number;
  /**
   * Per-skill ablation: resolve a suite's skill to its two materialized
   * projects (see `suite/isolate.ts`). When set, both arms run with discovery
   * restricted to their project and the Skill tool stays available — the
   * "without" arm loses only the target, not its siblings. Callers must
   * reject suites that declare their own `cwd` first.
   */
  isolation?: (skill: string) => ArmProjects;
  onProgress?: ProgressFn;
}

/** A/B result for one case. */
export interface BenchCaseResult {
  id: string;
  /** `skipped` = no output checks or negative case. */
  status: "done" | "skipped" | "todo";
  /** Trials per arm. */
  trials: number;
  /** Passing trials with the skill available. */
  withPassed: number;
  /** Passing trials with skills blocked. */
  withoutPassed: number;
  /** Both arms combined. */
  costUsd: number;
}

/** A/B result for one suite. */
export interface BenchSuiteResult {
  skill: string;
  file: string;
  cases: BenchCaseResult[];
}

/** Bench every benchable case in every suite. */
export async function benchSuites(
  suites: Suite[],
  runner: AgentRunner,
  config: BenchConfig = {},
): Promise<BenchSuiteResult[]> {
  const trials = config.trials ?? BENCH_TRIALS;
  const results: BenchSuiteResult[] = [];
  const jobs: Job[] = [];

  for (const suite of suites) {
    const model = config.model ?? suite.model;
    const judge = createJudge(runner, model);
    const suiteResult: BenchSuiteResult = {
      skill: suite.skill,
      file: suite.file ?? "",
      cases: [],
    };
    results.push(suiteResult);

    for (const testCase of suite.cases) {
      const caseResult: BenchCaseResult = {
        id: testCase.id,
        status: "done",
        trials,
        withPassed: 0,
        withoutPassed: 0,
        costUsd: 0,
      };
      suiteResult.cases.push(caseResult);

      if (isUnwritten(testCase)) {
        caseResult.status = "todo";
        continue;
      }
      if (!isBenchable(testCase)) {
        caseResult.status = "skipped";
        continue;
      }
      const projects = config.isolation?.(suite.skill);
      const cwd = projects ? undefined : resolveCwd(suite, testCase);
      const arm = (withoutSkill: boolean) =>
        armJob(
          testCase,
          model,
          runner,
          judge,
          config,
          caseResult,
          withoutSkill,
          projects
            ? withoutSkill
              ? projects.withoutCwd
              : projects.withCwd
            : cwd,
          projects !== undefined,
        );
      for (let trial = 0; trial < trials; trial += 1) {
        // Interleave the arms so drift hits both equally.
        jobs.push(arm(false), arm(true));
      }
    }
  }

  await runPool(
    jobs,
    config.concurrency ?? DEFAULT_CONCURRENCY,
    config.onProgress,
  );
  return results;
}

/** One trial of one arm. Mutates `caseResult`. */
function armJob(
  testCase: TestCase,
  model: string | undefined,
  runner: AgentRunner,
  judge: Judge,
  config: BenchConfig,
  caseResult: BenchCaseResult,
  withoutSkill: boolean,
  cwd: string | undefined,
  isolated: boolean,
): Job {
  return async () => {
    const outcome = await runner.run(testCase.prompt, {
      model,
      maxTurns: HAPPY_MAX_TURNS, // no early exit — bench needs the full output
      timeoutMs: config.timeoutMs ?? RUN_TIMEOUT_MS,
      cwd,
      // Isolated ablation removes the target from the "without" project
      // instead of blocking the Skill tool — siblings stay free to fire.
      disallowSkills: isolated ? undefined : withoutSkill,
      isolate: isolated ? true : undefined,
    });
    const checks = await evaluateOutputChecks(testCase, outcome, judge);
    if (checks.every((check) => check.ok)) {
      if (withoutSkill) caseResult.withoutPassed += 1;
      else caseResult.withPassed += 1;
    }
    caseResult.costUsd += outcome.costUsd;
  };
}
