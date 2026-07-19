/**
 * @file Scaffolds a new skill directory with a starter `SKILL.md`. Offline and
 * deterministic — placeholders plus distilled authoring guidance, never
 * invented content.
 */

import fs from "node:fs";
import path from "node:path";
import { skillNameProblems } from "./skillmd.js";

/**
 * Create `<dir>/<skill>/SKILL.md` from the starter template.
 *
 * @param {string} skill                     Kebab-case skill name.
 * @param {string} [dir]                     Parent directory. Defaults to `.`.
 * @returns {{ dir: string, file: string }}
 * @throws {Error} When the name is invalid or the `SKILL.md` already exists.
 */
export function newSkill(skill, dir) {
  // Same grammar `lint` enforces — better to fail here than after writing.
  const nameProblems = skillNameProblems(skill);
  if (nameProblems.length > 0) {
    throw new Error(nameProblems.map((problem) => problem.message).join("; "));
  }

  const skillDir = path.join(dir ?? ".", skill);
  const file = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(file, renderTemplate(skill));
  return { dir: skillDir, file };
}

/**
 * The starter `SKILL.md` body.
 *
 * @param {string} skill
 * @returns {string}
 */
function renderTemplate(skill) {
  return `---
name: ${skill}
description: TODO — what this skill does AND when to use it. State the concrete trigger contexts and phrases; keep it free of angle brackets.
---

<!--
Authoring guide (delete this comment when done):

- The description above is the PRIMARY triggering mechanism. State what the
  skill does AND the concrete contexts where it applies. Claude tends to
  under-trigger skills, so be a little "pushy" — list the trigger phrases a
  real user would type.
- ALL "when to use" information belongs in the description, not the body.
  The body is only loaded after the skill has already triggered.
- Keep SKILL.md under 500 lines. If you need more, layer it (progressive
  disclosure): references/ for docs loaded as needed, scripts/ for executable
  helpers, assets/ for files used in output.
- Write instructions in imperative form. Explain WHY things matter instead of
  heavy-handed MUSTs — the model reasons better from rationale than rules.
- After writing, test triggering with:
    skillevel init ${skill} && skillevel ${skill}
  and measure whether the skill actually improves the output with:
    skillevel bench ${skill}
-->

# ${skill}

TODO — one-paragraph overview: what this skill helps with and the outcome it
produces.

## Instructions

TODO — the steps or principles Claude should follow, in imperative form.

## Examples

TODO — one or two realistic input/output examples (optional; delete if the
instructions stand on their own).
`;
}
