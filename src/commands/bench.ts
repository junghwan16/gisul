/**
 * The `bench` command: run each benchable case with and without the skill,
 * grade both outputs, report the lift.
 *
 * Two "without" baselines exist. The default blocks the Skill tool outright
 * (skill vs no skills at all). `--isolate` materializes temp projects instead:
 * the "with" arm sees every discoverable skill and the "without" arm sees
 * every skill except the target — true per-skill ablation, siblings free to
 * fire in both arms. `--skill-dir` additionally swaps the target for an
 * uncommitted working copy (and implies `--isolate`).
 */

import pc from "picocolors";
import {
  benchSuites,
  type ArmProjects,
  type BenchConfig,
} from "../core/bench-runner.js";
import { summarizeBench } from "../core/summary.js";
import { renderBench, renderBenchSummary } from "../report/render.js";
import type { Suite } from "../core/types.js";
import {
  collectSkillDirs,
  materializeProject,
  removeProject,
  resolveSkillDir,
} from "../suite/isolate.js";
import type { CommandContext, CommandIo } from "./context.js";
import {
  loadSuitesOrReport,
  rejectSuiteCwds,
  reportError,
  writeJson,
} from "./helpers.js";

export interface BenchCommandOptions {
  filter?: string;
  concurrency?: number;
  model?: string;
  trials?: number;
  json?: string;
  /** Exit non-zero when overall lift is below this many percentage points. */
  minLift?: number;
  /** Per-skill ablation in isolated temp projects instead of blocking all skills. */
  isolate?: boolean;
  /** Bench the working-copy skill at this path (implies `isolate`). */
  skillDir?: string;
}

/** Returns the process exit code. */
export async function benchCommand(
  target: string | undefined,
  options: BenchCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const suites = loadSuitesOrReport(ctx.io, target, options.filter);
  if (!suites) return 0;

  const cleanup: string[] = [];
  let isolation: BenchConfig["isolation"];
  if (options.isolate || options.skillDir) {
    if (rejectSuiteCwds(ctx.io, suites, "--isolate")) return 1;
    try {
      isolation = buildIsolation(suites, options.skillDir, cleanup);
    } catch (error) {
      cleanup.forEach(removeProject);
      return reportError(ctx.io, error);
    }
    describeIsolation(ctx.io, options.skillDir);
  }

  let results;
  try {
    results = await ctx.withProgress((onProgress) =>
      benchSuites(suites, ctx.runner, {
        trials: options.trials,
        concurrency: options.concurrency,
        model: options.model,
        isolation,
        onProgress,
      }),
    );
  } catch (error) {
    return reportError(ctx.io, error);
  } finally {
    cleanup.forEach(removeProject);
  }

  ctx.io.out(renderBench(results));
  const summary = summarizeBench(results);
  ctx.io.out(renderBenchSummary(summary));
  writeJson(ctx.io, options.json, results);

  const minLift = options.minLift;
  const failed =
    minLift !== undefined &&
    (summary.benched === 0 || summary.liftPp < minLift);
  return failed ? 1 : 0;
}

/**
 * Materialize the isolated projects: one "with" project holding every
 * discoverable skill (working copy winning when `--skill-dir` is given), and
 * per target skill a "without" project missing only that skill. Registers
 * every temp dir in `cleanup`.
 *
 * @throws {Error} When a benched skill cannot be found anywhere.
 */
function buildIsolation(
  suites: Suite[],
  skillDir: string | undefined,
  cleanup: string[],
): (skill: string) => ArmProjects {
  const skills = collectSkillDirs();
  if (skillDir) {
    const override = resolveSkillDir(skillDir);
    skills.set(override.name, override.dir);
  }

  const targets = [...new Set(suites.map((suite) => suite.skill))];
  for (const targetSkill of targets) {
    if (!skills.has(targetSkill)) {
      throw new Error(
        `skill '${targetSkill}' not found in this repo or ~/.claude/skills — nothing to ablate`,
      );
    }
  }

  const withCwd = materializeProject(skills);
  cleanup.push(withCwd);
  const projects = new Map<string, ArmProjects>();
  for (const targetSkill of targets) {
    const ablated = new Map(skills);
    ablated.delete(targetSkill);
    const withoutCwd = materializeProject(ablated);
    cleanup.push(withoutCwd);
    projects.set(targetSkill, { withCwd, withoutCwd });
  }
  return (skill) => projects.get(skill)!;
}

/** Say which baseline the run uses, so the numbers can't be misread. */
function describeIsolation(io: CommandIo, skillDir: string | undefined): void {
  const withArm = skillDir
    ? `with arm: working copy at ${skillDir}`
    : "with arm: all skills";
  io.out(
    pc.dim(
      `isolated ablation — ${withArm}; without arm: every skill except the target`,
    ),
  );
}
