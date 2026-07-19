/**
 * @file Finds eval files on disk. A small hand-rolled walk keeps the tool
 * dependency-free (no glob library).
 */

import fs from "node:fs";
import path from "node:path";

/** Directories never worth descending into. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "coverage"]);

/**
 * Whether a file is an eval file: `*.eval.yaml` / `*.eval.yml`, or an
 * `evals/cases.yaml`.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isEvalFile(filePath) {
  const name = path.basename(filePath);
  if (/\.eval\.ya?ml$/.test(name)) return true;
  return name === "cases.yaml" && path.basename(path.dirname(filePath)) === "evals";
}

/**
 * Discover eval files under `root`. If `root` is itself a file, it is returned
 * as the only entry.
 *
 * @param {string} [root]
 * @returns {string[]} Sorted absolute-or-relative paths.
 */
export function discover(root = process.cwd()) {
  if (fs.statSync(root, { throwIfNoEntry: false })?.isFile()) return [root];

  /** @type {string[]} */
  const found = [];
  walk(root, found);
  return found.sort();
}

/**
 * Recursively collect eval files under `dir` into `sink`.
 *
 * @param {string} dir
 * @param {string[]} sink
 * @returns {void}
 */
function walk(dir, sink) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(full, sink);
    } else if (isEvalFile(full)) {
      sink.push(full);
    }
  }
}
