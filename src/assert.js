/**
 * @file Turns a run outcome into pass/fail checks for a case: the primary
 * trigger check plus any extra `expect` assertions.
 */

import { runClaude } from "./claude.js";
import { DEFAULT_JUDGE_MODEL, JUDGE_TIMEOUT_MS } from "./constants.js";

/**
 * Evaluate one trial of a case.
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {string} skill                 The suite's target skill.
 * @param {import('./types.js').RunOutcome} outcome
 * @param {string} [judgeModel]          Model for LLM-judge checks.
 * @returns {Promise<import('./types.js').CheckResult[]>}
 */
export async function evaluateTrial(testCase, skill, outcome, judgeModel) {
  // trigger shorthands are already covered by the primary check; the rest are
  // independent, so evaluate them concurrently (a `judge` check spawns a subprocess)
  const outputChecks =
    /** @type {Array<Exclude<import('./types.js').Expectation, string>>} */ (
      (testCase.expect ?? []).filter(
        (expectation) => typeof expectation === "object",
      )
    );
  const evaluated = await Promise.all(
    outputChecks.map((expectation) =>
      evaluateExpectation(expectation, outcome, judgeModel),
    ),
  );
  return [triggerCheck(testCase, skill, outcome), ...evaluated];
}

/**
 * The always-present check. With `should_trigger`, did the target skill fire
 * as declared? With `expect_skill`, did the routing go where it should — to
 * the named sibling (target staying out) or to no skill at all?
 *
 * @param {import('./types.js').TestCase} testCase
 * @param {string} skill
 * @param {import('./types.js').RunOutcome} outcome
 * @returns {import('./types.js').CheckResult}
 */
function triggerCheck(testCase, skill, outcome) {
  const fired = outcome.skillsFired;
  const expected = testCase.expect_skill;
  let label;
  let ok;
  if (expected !== undefined && expected !== skill) {
    if (expected === "none") {
      label = "no skill fires";
      ok = fired.length === 0;
    } else {
      label = `routes to ${expected}`;
      ok = fired.includes(expected) && !fired.includes(skill);
    }
  } else {
    label = testCase.should_trigger
      ? `triggers ${skill}`
      : `stays out (${skill})`;
    ok = fired.includes(skill) === testCase.should_trigger;
  }
  return {
    label,
    ok,
    detail: ok ? undefined : `fired: ${fired.join(", ") || "none"}`,
  };
}

/**
 * Evaluate a non-shorthand expectation against the response.
 *
 * @param {Exclude<import('./types.js').Expectation, string>} expectation
 * @param {import('./types.js').RunOutcome} outcome
 * @param {string} [judgeModel]
 * @returns {Promise<import('./types.js').CheckResult>}
 */
async function evaluateExpectation(expectation, outcome, judgeModel) {
  if ("match" in expectation) {
    return {
      label: `match /${expectation.match}/`,
      ok: toRegExp(expectation.match).test(outcome.text),
    };
  }
  if ("absent" in expectation) {
    return {
      label: `absent /${expectation.absent}/`,
      ok: !toRegExp(expectation.absent).test(outcome.text),
    };
  }
  if ("judge" in expectation) {
    const verdict = await judge(expectation.judge, outcome.text, judgeModel);
    return { label: "judge", ok: verdict.ok, detail: verdict.reason };
  }
  return { label: "unknown expectation", ok: false };
}

/**
 * Compile a case-insensitive regex, falling back to a literal substring match
 * when the pattern is not valid regex.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function toRegExp(pattern) {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

/**
 * Ask a fresh Claude (no skills, one turn) to grade a response against a rubric.
 *
 * @param {string} question
 * @param {string} answer
 * @param {string} [model]
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function judge(question, answer, model = DEFAULT_JUDGE_MODEL) {
  const prompt = [
    "You are grading an AI assistant's response against a criterion.",
    `Criterion: ${question}`,
    "",
    "--- RESPONSE ---",
    answer.slice(0, 6000),
    "--- END ---",
    "",
    'Reply with exactly "PASS" or "FAIL" as the first word, then a one-line reason.',
  ].join("\n");

  const outcome = await runClaude(prompt, {
    model,
    maxTurns: 1,
    timeoutMs: JUDGE_TIMEOUT_MS,
  });
  return {
    ok: /^\s*pass\b/i.test(outcome.text),
    reason: outcome.text.split("\n").slice(1).join(" ").trim().slice(0, 140),
  };
}
