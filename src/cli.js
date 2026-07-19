#!/usr/bin/env node
/**
 * @file Command-line entry point. Wires the pieces together; the real work
 * lives in the sibling modules.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import { collectSuites } from "./load.js";
import { runSuites } from "./run.js";
import { benchSuites, summarizeBench } from "./bench.js";
import {
  renderBench,
  renderBenchSummary,
  renderGrid,
  renderSummary,
  summarize,
} from "./report.js";
import { initSuite } from "./init.js";
import { newSkill } from "./scaffold.js";
import { lintSkillMd } from "./lint.js";
import { formatSkillMd } from "./fmt.js";
import { findSkill, resolveSkillMds } from "./resolve.js";
import {
  BENCH_TRIALS,
  DEFAULT_CONCURRENCY,
  DEFAULT_THRESHOLD,
} from "./constants.js";

const { version } = createRequire(import.meta.url)("../package.json");

main();

/** Parse arguments and dispatch. */
function main() {
  const program = new Command();
  program
    .name("skillevel")
    .description(
      "A test runner for Claude Code skills. Runs YAML cases through `claude -p`.",
    )
    .version(version);

  program
    .argument(
      "[target]",
      "a skill name or an eval file; omit to run everything discovered",
    )
    .option("-t, --filter <substr>", "only run cases whose id contains this")
    .option(
      "-c, --concurrency <n>",
      "parallel runs",
      String(DEFAULT_CONCURRENCY),
    )
    .option("-m, --model <model>", "override the model for all runs")
    .option(
      "--threshold <n>",
      "green pass-rate threshold (0..1)",
      String(DEFAULT_THRESHOLD),
    )
    .option("--json <file>", "also write full results as JSON to a file")
    .option("--ci", "exit non-zero on any failure or unwritten case")
    .action(runCommand);

  program
    .command("bench [target]")
    .description(
      "A/B each case with the skill vs with skills blocked, and report the lift",
    )
    .option("-t, --filter <substr>", "only bench cases whose id contains this")
    .option(
      "-c, --concurrency <n>",
      "parallel runs",
      String(DEFAULT_CONCURRENCY),
    )
    .option("-m, --model <model>", "override the model for all runs")
    .option("--trials <n>", "trials per arm", String(BENCH_TRIALS))
    .option("--json <file>", "also write full results as JSON to a file")
    .option(
      "--min-lift <pp>",
      "exit non-zero when overall lift is below this many percentage points",
    )
    .action(benchCommand);

  program
    .command("new <skill> [dir]")
    .description(
      "Scaffold whatever the skill is missing: <skill>/SKILL.md (unless the skill already exists) and <skill>.eval.yaml — templates + guidance; you write the content",
    )
    .action(newCommand);

  program
    .command("lint [targets...]")
    .description(
      "Lint SKILL.md files: packaging errors + authoring-guidance warnings",
    )
    .action(lintCommand);

  program
    .command("fmt [targets...]")
    .description("Normalise SKILL.md frontmatter and whitespace")
    .option("--check", "report files that would change, without writing")
    .action(fmtCommand);

  program.parseAsync();
}

/**
 * The default command: discover, run, report.
 *
 * @param {string | undefined} target
 * @param {Record<string, string | boolean | undefined>} options
 * @returns {Promise<void>}
 */
async function runCommand(target, options) {
  const suites = loadSuitesOrExit(target, options.filter, Boolean(options.ci));
  const results = await withProgress((onProgress) =>
    runSuites(suites, {
      concurrency: Number(options.concurrency),
      threshold: Number(options.threshold),
      model: /** @type {string | undefined} */ (options.model),
      onProgress,
    }),
  );
  console.log(renderGrid(results));
  const summary = summarize(results);
  console.log(renderSummary(summary));
  writeJson(options.json, results);

  const failed = summary.fail > 0 || (Boolean(options.ci) && summary.todo > 0);
  process.exit(failed ? 1 : 0);
}

/**
 * The `bench` command: run each benchable case with and without the skill,
 * grade both outputs, report the lift.
 *
 * @param {string | undefined} target
 * @param {Record<string, string | boolean | undefined>} options
 * @returns {Promise<void>}
 */
async function benchCommand(target, options) {
  const suites = loadSuitesOrExit(target, options.filter, false);
  const results = await withProgress((onProgress) =>
    benchSuites(suites, {
      trials: Number(options.trials),
      concurrency: Number(options.concurrency),
      model: /** @type {string | undefined} */ (options.model),
      onProgress,
    }),
  );
  console.log(renderBench(results));
  const summary = summarizeBench(results);
  console.log(renderBenchSummary(summary));
  writeJson(options.json, results);

  const minLift =
    options.minLift === undefined ? null : Number(options.minLift);
  const failed =
    minLift !== null && (summary.benched === 0 || summary.liftPp < minLift);
  process.exit(failed ? 1 : 0);
}

/**
 * Resolve `target` to suites, reporting skipped files. Exits when nothing is
 * found — non-zero only when the caller treats emptiness as failure (`--ci`).
 *
 * @param {string | undefined | unknown} target
 * @param {string | boolean | undefined} filter
 * @param {boolean} failWhenEmpty
 * @returns {import('./types.js').Suite[]}
 */
function loadSuitesOrExit(target, filter, failWhenEmpty) {
  const { suites, skipped } = collectSuites(
    typeof target === "string" ? target : undefined,
    /** @type {string | undefined} */ (filter),
  );
  for (const { file, error } of skipped) {
    console.error(pc.red(`skip ${file}: ${error.message}`));
  }
  if (suites.length === 0) {
    console.error(
      pc.yellow(
        "no eval suites found (looked for *.eval.yaml / evals/cases.yaml)",
      ),
    );
    process.exit(failWhenEmpty ? 1 : 0);
  }
  return suites;
}

/**
 * Run a suite batch with a progress line, clearing it afterwards. A runner
 * error (e.g. the `claude` CLI missing) exits with its message instead of a
 * stack trace.
 *
 * @template T
 * @param {(onProgress: (done: number, total: number) => void) => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withProgress(run) {
  const clearLine = () => process.stdout.write(`\r${" ".repeat(30)}\r`);
  const onProgress = (
    /** @type {number} */ done,
    /** @type {number} */ total,
  ) => process.stdout.write(`\r${pc.dim(`running ${done}/${total}…`)}   `);
  try {
    const results = await run(onProgress);
    clearLine();
    return results;
  } catch (error) {
    clearLine();
    return exitWith(error);
  }
}

/**
 * Write results as JSON when `--json <file>` was given.
 *
 * @param {string | boolean | undefined} file
 * @param {unknown} results
 * @returns {void}
 */
function writeJson(file, results) {
  if (typeof file !== "string") return;
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(pc.dim(`\nwrote ${file}`));
}

/**
 * The `new` command: one on-ramp. Scaffolds the pieces the skill is missing —
 * a `SKILL.md` when the skill exists nowhere (locally or installed), and a
 * cases file when there is none — and skips what's already there.
 *
 * @param {string} skill
 * @param {string} [dir]
 * @returns {void}
 */
function newCommand(skill, dir) {
  try {
    const existing = findSkill(skill);
    if (existing) {
      console.log(
        pc.dim(`skill exists — ${existing.path} (${existing.source})`),
      );
    } else {
      const { file } = newSkill(skill, dir);
      console.log(pc.green(`created ${file}`));
    }

    const evalFile = `${skill}.eval.yaml`;
    if (fs.existsSync(evalFile)) {
      console.log(pc.dim(`cases exist — ${evalFile}`));
    } else {
      const { file } = initSuite(skill, evalFile);
      console.log(pc.green(`created ${file}`));
    }

    console.log(
      pc.dim(
        `write the content, then: skillevel ${skill}  ·  skillevel bench ${skill}`,
      ),
    );
  } catch (error) {
    exitWith(error);
  }
}

/**
 * The `lint` command.
 *
 * @param {string[]} targets
 * @returns {void}
 */
function lintCommand(targets) {
  const files = resolveSkillMdsOrExit(targets);
  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    const { problems } = lintSkillMd(file);
    if (problems.length === 0) {
      console.log(`${pc.green("✓")} ${file}`);
      continue;
    }
    console.log(file);
    for (const { severity, rule, message } of problems) {
      const paint = severity === "error" ? pc.red : pc.yellow;
      console.log(`  ${paint(`${severity} ${rule}`)} — ${message}`);
      if (severity === "error") errors += 1;
      else warnings += 1;
    }
  }
  const parts = [
    countFiles(files.length),
    errors ? pc.red(`${errors} errors`) : pc.dim("0 errors"),
    warnings ? pc.yellow(`${warnings} warnings`) : pc.dim("0 warnings"),
  ];
  console.log(`\n${parts.join(pc.dim(" · "))}`);
  process.exit(errors > 0 ? 1 : 0);
}

/**
 * The `fmt` command.
 *
 * @param {string[]} targets
 * @param {{ check?: boolean }} options
 * @returns {void}
 */
function fmtCommand(targets, options) {
  const files = resolveSkillMdsOrExit(targets);
  let changed = 0;
  let unreadable = 0;
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (error) {
      console.error(
        pc.red(`cannot read ${file}: ${/** @type {Error} */ (error).message}`),
      );
      unreadable += 1;
      continue;
    }
    const formatted = formatSkillMd(source);
    if (formatted === source) continue; // untouched — no mtime churn
    changed += 1;
    if (options.check) {
      console.log(pc.yellow(`would format ${file}`));
    } else {
      fs.writeFileSync(file, formatted);
      console.log(pc.green(`formatted ${file}`));
    }
  }
  if (changed === 0 && unreadable === 0) {
    console.log(pc.dim(`${countFiles(files.length)} already formatted`));
  }
  process.exit(unreadable > 0 || (options.check && changed > 0) ? 1 : 0);
}

/**
 * Resolve lint/fmt targets to `SKILL.md` paths (see `resolveSkillMds`), or
 * print the failure and exit.
 *
 * @param {string[]} targets
 * @returns {string[]}
 */
function resolveSkillMdsOrExit(targets) {
  try {
    return resolveSkillMds(targets);
  } catch (error) {
    return exitWith(error);
  }
}

/**
 * Print the error message in red and exit 1 — the shared command epilogue.
 *
 * @param {unknown} error
 * @returns {never}
 */
function exitWith(error) {
  console.error(pc.red(/** @type {Error} */ (error).message));
  process.exit(1);
}

/**
 * "1 file" / "3 files".
 *
 * @param {number} n
 * @returns {string}
 */
function countFiles(n) {
  return `${n} file${n === 1 ? "" : "s"}`;
}
