/**
 * The default command: discover, run, report.
 */

import { runSuites } from "../core/eval-runner.js";
import { summarize } from "../core/summary.js";
import { renderGrid, renderSummary } from "../report/render.js";
import {
  collectSkillDirs,
  materializeProject,
  removeProject,
  resolveSkillDir,
} from "../suite/isolate.js";
import type { CommandContext } from "./context.js";
import {
  loadSuitesOrReport,
  rejectSuiteCwds,
  reportError,
  writeJson,
} from "./helpers.js";

export interface RunCommandOptions {
  filter?: string;
  concurrency?: number;
  threshold?: number;
  model?: string;
  trials?: number;
  json?: string;
  ci?: boolean;
  /** Eval the working-copy skill at this path in an isolated temp project. */
  skillDir?: string;
}

/** Returns the process exit code. */
export async function runCommand(
  target: string | undefined,
  options: RunCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const suites = loadSuitesOrReport(ctx.io, target, options.filter);
  if (!suites) return options.ci ? 1 : 0;

  // `--skill-dir`: materialize every discoverable skill — with the working
  // copy overriding its installed namesake — into a temp project all runs use.
  let isolation: { cwd: string } | undefined;
  if (options.skillDir) {
    if (rejectSuiteCwds(ctx.io, suites, "--skill-dir")) return 1;
    try {
      const override = resolveSkillDir(options.skillDir);
      const skills = collectSkillDirs();
      skills.set(override.name, override.dir);
      isolation = { cwd: materializeProject(skills) };
    } catch (error) {
      return reportError(ctx.io, error);
    }
  }

  let results;
  try {
    results = await ctx.withProgress((onProgress) =>
      runSuites(suites, ctx.runner, {
        concurrency: options.concurrency,
        threshold: options.threshold,
        model: options.model,
        trials: options.trials,
        isolation,
        onProgress,
      }),
    );
  } catch (error) {
    return reportError(ctx.io, error);
  } finally {
    if (isolation) removeProject(isolation.cwd);
  }

  ctx.io.out(renderGrid(results));
  const summary = summarize(results);
  ctx.io.out(renderSummary(summary));
  writeJson(ctx.io, options.json, results);

  const failed = summary.fail > 0 || (Boolean(options.ci) && summary.todo > 0);
  return failed ? 1 : 0;
}
