/**
 * @file Shared defaults. Kept in one place so behaviour is easy to reason about
 * and there are no magic numbers scattered across the codebase.
 */

/** Default number of times each case runs (variance needs more than one). */
export const DEFAULT_TRIALS = 3;

/** A case is green when its pass-rate is at least this (0..1). */
export const DEFAULT_THRESHOLD = 0.8;

/** Default number of cases/trials run in parallel. */
export const DEFAULT_CONCURRENCY = 4;

/** Hard timeout for a single `claude -p` run. */
export const RUN_TIMEOUT_MS = 120_000;

/** Turn cap for a "should fire" run (early-exit usually ends it sooner). */
export const HAPPY_MAX_TURNS = 6;

/** Turn cap for a "must not fire" run — kept low to bound negatives. */
export const NEGATIVE_MAX_TURNS = 3;

/** Timeout for a single LLM-judge call. */
export const JUDGE_TIMEOUT_MS = 60_000;

/**
 * Default trials per arm for `bench` — lower than eval trials because every
 * bench case runs twice (with/without) plus a grader call per output.
 */
export const BENCH_TRIALS = 3;

/** Model used by the LLM judge when a suite does not specify one. */
export const DEFAULT_JUDGE_MODEL = "sonnet";

/** How deep skill discovery walks from its starting directory. */
export const MAX_WALK_DEPTH = 6;

/**
 * Directories no discovery ever descends into. Eval discovery additionally
 * skips dot-directories; skill walks must not (skills live in `.claude/`).
 */
export const WALK_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
]);
