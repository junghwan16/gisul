/**
 * @file Locates a skill's `SKILL.md` and reads the bits `init` needs. A working
 * copy under the current directory wins over the installed one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

/**
 * @typedef {object} SkillMeta
 * @property {string} path                   Path to the `SKILL.md`.
 * @property {"local" | "installed"} source
 * @property {string} name                   Frontmatter `name`, or the folder name.
 * @property {string} description            Frontmatter `description`.
 * @property {string} [triggers]             Verbatim trigger-keyword line, if any.
 */

const MAX_WALK_DEPTH = 6;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

/**
 * Find a skill's `SKILL.md`. Prefers a working copy under `root`; falls back to
 * `~/.claude/skills/<name>/SKILL.md`.
 *
 * @param {string} name
 * @param {string} [root]
 * @returns {SkillMeta | null}
 */
export function findSkill(name, root = process.cwd()) {
  const local = findLocalSkillMd(root, name);
  if (local) return readMeta(local, "local");

  const installed = path.join(os.homedir(), ".claude", "skills", name, "SKILL.md");
  return fs.existsSync(installed) ? readMeta(installed, "installed") : null;
}

/**
 * Depth-limited search for `<dir>/**\/<name>/SKILL.md`.
 *
 * @param {string} dir
 * @param {string} name
 * @param {number} [depth]
 * @returns {string | null}
 */
function findLocalSkillMd(dir, name, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    if (entry.name === name) {
      const candidate = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(candidate)) return candidate;
    }
    const nested = findLocalSkillMd(path.join(dir, entry.name), name, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Read the frontmatter fields `init` uses.
 *
 * @param {string} skillMdPath
 * @param {"local" | "installed"} source
 * @returns {SkillMeta}
 */
function readMeta(skillMdPath, source) {
  const raw = fs.readFileSync(skillMdPath, "utf8");
  let name = path.basename(path.dirname(skillMdPath));
  let description = "";

  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    try {
      /** @type {{ name?: string, description?: string }} */
      const data = parse(frontmatter[1]);
      name = data.name ?? name;
      description = data.description ?? "";
    } catch {
      // frontmatter isn't strict YAML — keep the folder-name fallback
    }
  }

  const triggers = description.match(/(?:triggers?)\s*[:—-]\s*(.+)/i)?.[1]?.trim();
  return { path: skillMdPath, source, name, description, triggers };
}
