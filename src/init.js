/**
 * @file Scaffolds a cases file for a skill. Offline and deterministic — it fills
 * in a template and echoes the skill's own trigger keywords, but never invents
 * cases (auto-generated tests plant plausible-but-wrong checks).
 */

import fs from "node:fs";
import path from "node:path";
import { findSkill } from "./resolve.js";

const COMMENT_WRAP_WIDTH = 72;

/**
 * Write a starter cases file for `skill`.
 *
 * @param {string} skill
 * @param {string} [outFile]                 Defaults to `<skill>.eval.yaml`.
 * @returns {{ file: string, source: string }}
 * @throws {Error} When the target file already exists.
 */
export function initSuite(skill, outFile) {
  const meta = findSkill(skill);
  const file = outFile ?? `${skill}.eval.yaml`;

  const dir = path.dirname(file);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);

  fs.writeFileSync(file, renderTemplate(skill, triggerHint(skill, meta)));
  return { file, source: meta ? `${meta.source}: ${meta.path}` : "not found" };
}

/**
 * A comment block hinting at what the skill should trigger on.
 *
 * @param {string} skill
 * @param {import('./resolve.js').SkillMeta | null} meta
 * @returns {string}
 */
function triggerHint(skill, meta) {
  if (meta?.triggers) {
    return [
      "",
      "# Trigger keywords this skill claims (verbatim from its SKILL.md — weave these",
      "# into happy prompts; make negatives drift just outside them):",
      `#   ${wrapComment(meta.triggers)}`,
      "",
    ].join("\n");
  }
  if (meta) {
    return "\n# (This skill's SKILL.md has no explicit trigger list — read its description.)\n";
  }
  return `\n# NOTE: no SKILL.md found for "${skill}" in this repo or ~/.claude/skills.\n#       Fill in real cases from how you actually use the skill.\n`;
}

/**
 * Word-wrap a string into comment continuation lines.
 *
 * @param {string} text
 * @param {number} [width]
 * @returns {string}
 */
function wrapComment(text, width = COMMENT_WRAP_WIDTH) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n#   ");
}

/**
 * The starter cases file body.
 *
 * @param {string} skill
 * @param {string} triggerHintBlock
 * @returns {string}
 */
function renderTemplate(skill, triggerHintBlock) {
  return `# ${skill}.eval.yaml — skillevel test cases
# init scaffolded this. Delete the examples and write your own cases.
#
# Principles (authoring guide):
#   - Start with 5 happy + 5 negative — never skip negatives (over-trigger check)
#   - Negatives should be near-misses ("adjacent but must NOT fire"); obvious
#     unrelated prompts are weak
#   - Real usage / production traces make the best cases — paste them in
#   - Judge the result, not the path — not "loaded on turn 1", but "did the task"
#   - Happy cases with match/absent/judge also power \`skillevel bench ${skill}\`
#     (skill-on vs skill-off lift — does the skill actually help?)
${triggerHintBlock}
skill: ${skill}
trials: 5

cases:
  # -- happy (should fire) — replace the example with 5 real ones -----------
  - id: happy-1
    prompt: "<a realistic prompt a user would send that SHOULD trigger this skill>"
    should_trigger: true
    expect:
      - triggered
      # - match: "<regex the response should contain, e.g. a tool or table name>"

  # happy-2 ... happy-5

  # -- negative (must NOT fire — near-miss) — write 5 real ones -------------
  - id: neg-1
    prompt: "<adjacent to the skill but must NOT trigger it>"
    should_trigger: false
    expect:
      - not_triggered

  # neg-2 ... neg-5
`;
}
