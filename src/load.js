/**
 * @file Reads and validates a cases file.
 */

import fs from "node:fs";
import { parse } from "yaml";

/**
 * Whether a prompt is still an unwritten placeholder (contains `<...>`).
 *
 * @param {string} prompt
 * @returns {boolean}
 */
export function isPlaceholder(prompt) {
  return /<[^>]+>/.test(prompt);
}

/**
 * Load and validate a suite from a YAML file.
 *
 * @param {string} filePath
 * @returns {import('./types.js').Suite}
 * @throws {Error} When the file is missing required fields or has duplicate ids.
 */
export function loadSuite(filePath) {
  /** @type {import('./types.js').Suite} */
  const suite = parse(fs.readFileSync(filePath, "utf8"));
  assert(suite && typeof suite.skill === "string", `${filePath}: missing 'skill'`);
  assert(Array.isArray(suite.cases) && suite.cases.length > 0, `${filePath}: no 'cases'`);

  const seenIds = new Set();
  for (const testCase of suite.cases) {
    assert(testCase.id, `${filePath}: a case is missing 'id'`);
    assert(testCase.prompt, `${filePath}: case '${testCase.id}' is missing 'prompt'`);
    assert(
      typeof testCase.should_trigger === "boolean",
      `${filePath}: case '${testCase.id}' needs 'should_trigger: true|false'`,
    );
    assert(!seenIds.has(testCase.id), `${filePath}: duplicate case id '${testCase.id}'`);
    seenIds.add(testCase.id);
  }

  suite.file = filePath;
  return suite;
}

/**
 * Throw with `message` unless `condition` is truthy.
 *
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
