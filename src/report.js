/**
 * @file Turns suite results into human- or machine-readable output. Reporters:
 * `grid` (default), `dot`, `json`, `junit`.
 */

import pc from "picocolors";

/**
 * @typedef {object} Summary
 * @property {number} pass
 * @property {number} fail
 * @property {number} todo
 * @property {number} costUsd
 */

/**
 * Count outcomes across all suites.
 *
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {Summary}
 */
export function summarize(suites) {
  const cases = suites.flatMap((suite) => suite.cases);
  /** @param {import('./types.js').CaseStatus} status */
  const count = (status) => cases.filter((c) => c.status === status).length;
  return {
    pass: count("pass"),
    fail: count("fail"),
    todo: count("todo"),
    costUsd: cases.reduce((total, c) => total + c.costUsd, 0),
  };
}

/**
 * Render results with the chosen reporter.
 *
 * @param {import('./types.js').SuiteResult[]} suites
 * @param {"grid" | "dot" | "json" | "junit" | string} reporter
 * @returns {string}
 */
export function render(suites, reporter) {
  switch (reporter) {
    case "json":
      return JSON.stringify(suites, null, 2);
    case "junit":
      return renderJUnit(suites);
    case "dot":
      return renderDot(suites);
    default:
      return renderGrid(suites);
  }
}

/**
 * Render the closing one-line summary.
 *
 * @param {Summary} summary
 * @returns {string}
 */
export function renderSummary(summary) {
  const parts = [
    summary.fail ? pc.red(`${summary.fail} failed`) : pc.dim("0 failed"),
    pc.green(`${summary.pass} passed`),
    summary.todo ? pc.yellow(`${summary.todo} todo`) : pc.dim("0 todo"),
  ];
  return `\n${parts.join(pc.dim(" · "))}${pc.dim(`   $${summary.costUsd.toFixed(3)}`)}`;
}

/**
 * The status glyph for a case.
 *
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {string}
 */
function glyph(caseResult) {
  if (caseResult.status === "pass") return pc.green("✓");
  if (caseResult.status === "todo") return pc.yellow("○");
  return pc.red("✗");
}

/**
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {number} How many trials passed.
 */
function passedTrials(caseResult) {
  return caseResult.trials.filter((trial) => trial.pass).length;
}

/**
 * The first failing check of the first failing trial, for a hint line.
 *
 * @param {import('./types.js').CaseResult} caseResult
 * @returns {import('./types.js').CheckResult | undefined}
 */
function firstFailure(caseResult) {
  return caseResult.trials.find((trial) => !trial.pass)?.checks.find((check) => !check.ok);
}

/**
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {string}
 */
function renderGrid(suites) {
  const lines = [];
  for (const suite of suites) {
    lines.push("", pc.bold(suite.skill) + pc.dim(`  ${suite.file}`));
    for (const caseResult of suite.cases) {
      const detail =
        caseResult.status === "todo"
          ? pc.yellow("TODO — unwritten")
          : `${passedTrials(caseResult)}/${caseResult.trials.length}`;
      lines.push(`  ${glyph(caseResult)} ${caseResult.id.padEnd(18)} ${pc.dim(detail)}`);
      if (caseResult.status === "fail") {
        const failure = firstFailure(caseResult);
        if (failure) lines.push(pc.dim(`      ✗ ${failure.label}${failure.detail ? ` — ${failure.detail}` : ""}`));
      }
    }
  }
  return lines.join("\n");
}

/**
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {string}
 */
function renderDot(suites) {
  return suites
    .flatMap((suite) => suite.cases)
    .map((c) => (c.status === "pass" ? pc.green(".") : c.status === "todo" ? pc.yellow("○") : pc.red("F")))
    .join("");
}

/**
 * @param {import('./types.js').SuiteResult[]} suites
 * @returns {string}
 */
function renderJUnit(suites) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<testsuites>"];
  for (const suite of suites) {
    const failures = suite.cases.filter((c) => c.status === "fail").length;
    lines.push(`  <testsuite name="${xml(suite.skill)}" tests="${suite.cases.length}" failures="${failures}">`);
    for (const caseResult of suite.cases) {
      lines.push(`    <testcase name="${xml(caseResult.id)}" classname="${xml(suite.skill)}">`);
      if (caseResult.status === "fail") {
        const failure = firstFailure(caseResult);
        lines.push(`      <failure message="${xml(failure?.label ?? "failed")}">${xml(failure?.detail ?? "")}</failure>`);
      } else if (caseResult.status === "todo") {
        lines.push(`      <skipped message="unwritten placeholder"/>`);
      }
      lines.push("    </testcase>");
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}

/**
 * Escape a string for use in XML text/attributes.
 *
 * @param {string} value
 * @returns {string}
 */
function xml(value) {
  return value.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch);
}
