/**
 * Small helpers shared by the command layer.
 */

import fs from "node:fs";
import pc from "picocolors";
import type { Suite } from "../core/types.js";
import { collectSuites } from "../suite/load.js";
import type { CommandIo } from "./context.js";

/**
 * Resolve `target` to suites, reporting skipped files. Returns `null` when
 * nothing is found — the caller decides whether emptiness is a failure.
 */
export function loadSuitesOrReport(
  io: CommandIo,
  target: string | undefined,
  filter: string | undefined,
): Suite[] | null {
  const { suites, skipped, filteredOut } = collectSuites(target, filter);
  for (const { file, error } of skipped) {
    io.err(pc.red(`skip ${file}: ${error.message}`));
  }
  if (suites.length === 0) {
    // A discovered-but-filtered-empty suite is a different problem from no file
    // at all — say which, so a mistyped `-t` isn't read as "nothing here".
    io.err(
      pc.yellow(
        filteredOut.length > 0
          ? `${filteredOut.length} suite(s) discovered, but no case id matches filter "${filter}"`
          : "no eval suites found (looked for *.eval.yaml / evals/cases.yaml)",
      ),
    );
    return null;
  }
  return suites;
}

/** Write results as JSON when `--json <file>` was given. */
export function writeJson(
  io: CommandIo,
  file: string | undefined,
  results: unknown,
): void {
  if (!file) return;
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  io.out(pc.dim(`\nwrote ${file}`));
}

/** "1 file" / "3 files". */
export function countFiles(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

/** Print the error message in red — the shared command epilogue. */
export function reportError(io: CommandIo, error: unknown): number {
  io.err(pc.red((error as Error).message));
  return 1;
}

/**
 * Isolated runs pin their working directory to a materialized temp project,
 * so a suite/case `cwd:` cannot be honoured. Report each offender and return
 * whether any were found — silently mis-running them would be worse than
 * refusing.
 */
export function rejectSuiteCwds(
  io: CommandIo,
  suites: Suite[],
  flag: string,
): boolean {
  const offenders = suites.filter(
    (suite) => suite.cwd || suite.cases.some((testCase) => testCase.cwd),
  );
  for (const suite of offenders) {
    io.err(
      pc.red(
        `${suite.file}: 'cwd:' conflicts with ${flag} — isolated runs pin their own working directory`,
      ),
    );
  }
  return offenders.length > 0;
}
