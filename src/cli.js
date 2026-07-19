#!/usr/bin/env node
/**
 * @file Command-line entry point. Wires the pieces together; the real work
 * lives in the sibling modules.
 */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { discover } from "./discover.js";
import { loadSuite } from "./load.js";
import { runSuites } from "./run.js";
import { render, renderSummary, summarize } from "./report.js";
import { initSuite } from "./init.js";
import { findSkill } from "./resolve.js";
import { DEFAULT_CONCURRENCY, DEFAULT_THRESHOLD } from "./constants.js";

const WATCH_DEBOUNCE_MS = 300;

main();

/** Parse arguments and dispatch. */
function main() {
  const program = new Command();
  program
    .name("skillevel")
    .description("A test runner for Claude Code skills. Runs YAML cases through `claude -p`.")
    .version("0.1.0");

  program
    .argument("[target]", "a skill name or an eval file; omit to run everything discovered")
    .option("-w, --watch", "re-run on file changes")
    .option("-t, --filter <substr>", "only run cases whose id contains this")
    .option("-r, --reporter <name>", "grid | dot | json | junit", "grid")
    .option("-c, --concurrency <n>", "parallel runs", String(DEFAULT_CONCURRENCY))
    .option("-m, --model <model>", "override the model for all runs")
    .option("--threshold <n>", "green pass-rate threshold (0..1)", String(DEFAULT_THRESHOLD))
    .option("--json <file>", "also write full results as JSON to a file")
    .option("--ci", "exit non-zero on any failure or unwritten case")
    .action(runCommand);

  program
    .command("init <skill> [file]")
    .description("Scaffold a cases file for a skill (template + guidance; you write the cases)")
    .action(initCommand);

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
  const suites = resolveSuites(typeof target === "string" ? target : undefined, /** @type {string} */ (options.filter));
  if (suites.length === 0) {
    console.error(pc.yellow("no eval suites found (looked for *.eval.yaml / evals/cases.yaml)"));
    process.exit(options.ci ? 1 : 0);
  }

  /** @type {import('./run.js').RunConfig} */
  const config = {
    concurrency: Number(options.concurrency),
    threshold: Number(options.threshold),
    model: /** @type {string | undefined} */ (options.model),
  };
  const runOnce = () => executeAndReport(suites, config, options);

  if (options.watch) {
    await watch(suites, runOnce);
    return;
  }
  const summary = await runOnce();
  const failed = summary.fail > 0 || (Boolean(options.ci) && summary.todo > 0);
  process.exit(failed ? 1 : 0);
}

/**
 * Run all suites once and print the report + summary.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {import('./run.js').RunConfig} config
 * @param {Record<string, string | boolean | undefined>} options
 * @returns {Promise<import('./report.js').Summary>}
 */
async function executeAndReport(suites, config, options) {
  const results = await runSuites(suites, {
    ...config,
    onProgress: (done, total) => process.stdout.write(`\r${pc.dim(`running ${done}/${total}…`)}   `),
  });
  process.stdout.write(`\r${" ".repeat(30)}\r`); // clear progress line

  const reporter = /** @type {string} */ (options.reporter);
  console.log(render(results, reporter));
  console.log(renderSummary(summarize(results)));

  if (typeof options.json === "string") {
    fs.writeFileSync(options.json, render(results, "json"));
    console.log(pc.dim(`\nwrote ${options.json}`));
  }
  return summarize(results);
}

/**
 * The `init` command.
 *
 * @param {string} skill
 * @param {string} [file]
 * @returns {void}
 */
function initCommand(skill, file) {
  try {
    const { file: created, source } = initSuite(skill, file);
    console.log(pc.green(`created ${created}`) + pc.dim(`  (skill: ${source})`));
    console.log(pc.dim(`edit it, then: skillevel ${skill}`));
  } catch (error) {
    console.error(pc.red(/** @type {Error} */ (error).message));
    process.exit(1);
  }
}

/**
 * Resolve the target into loaded, filtered suites.
 *
 * @param {string | undefined} target      A skill name or an eval file path.
 * @param {string | undefined} caseFilter  Keep only cases whose id contains this.
 * @returns {import('./types.js').Suite[]}
 */
function resolveSuites(target, caseFilter) {
  const files = filesForTarget(target);
  const suites = [];
  for (const file of files) {
    try {
      const suite = loadSuite(file);
      if (caseFilter) suite.cases = suite.cases.filter((testCase) => testCase.id.includes(caseFilter));
      if (suite.cases.length > 0) suites.push(suite);
    } catch (error) {
      console.error(pc.red(`skip ${file}: ${/** @type {Error} */ (error).message}`));
    }
  }
  return suites;
}

/**
 * The candidate eval files for a target (a file, a skill name, or everything).
 *
 * @param {string | undefined} target
 * @returns {string[]}
 */
function filesForTarget(target) {
  if (target && fs.existsSync(target) && fs.statSync(target).isFile()) return [target];
  const all = discover();
  if (!target) return all;
  return all.filter((file) => path.basename(path.dirname(file)) === target || file.includes(target));
}

/**
 * Watch the suites (and their SKILL.md files) and re-run on change.
 *
 * @param {import('./types.js').Suite[]} suites
 * @param {() => Promise<unknown>} runOnce
 * @returns {Promise<never>}
 */
async function watch(suites, runOnce) {
  const rerun = async () => {
    console.clear();
    console.log(pc.dim(`skillevel --watch  ·  ${new Date().toLocaleTimeString()}`));
    await runOnce();
    console.log(pc.dim("\nwatching for changes… (ctrl-c to quit)"));
  };

  await rerun();

  /** @type {NodeJS.Timeout | null} */
  let debounce = null;
  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(rerun, WATCH_DEBOUNCE_MS);
  };
  for (const filePath of watchTargets(suites)) {
    try {
      fs.watch(filePath, onChange);
    } catch {
      // not all files are watchable on all platforms — ignore
    }
  }
  return new Promise(() => {}); // keep the process alive
}

/**
 * The files worth watching: each suite file and each skill's SKILL.md.
 *
 * @param {import('./types.js').Suite[]} suites
 * @returns {string[]}
 */
function watchTargets(suites) {
  const targets = new Set();
  for (const suite of suites) {
    if (suite.file) targets.add(suite.file);
    const meta = findSkill(suite.skill);
    if (meta) targets.add(meta.path);
  }
  return [...targets];
}
