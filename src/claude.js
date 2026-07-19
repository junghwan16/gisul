/**
 * @file Thin wrapper around the `claude -p` CLI. Runs one prompt headless and
 * reports which skills/tools fired, the final text, and the cost.
 */

import { spawn } from "node:child_process";
import readline from "node:readline";
import { RUN_TIMEOUT_MS } from "./constants.js";

/**
 * Options for {@link runClaude}.
 *
 * @typedef {object} ClaudeOptions
 * @property {string} [model]                    Model alias for `--model`.
 * @property {number} [maxTurns]                 Cap passed to `--max-turns`.
 * @property {number} [timeoutMs]                Hard timeout (default {@link RUN_TIMEOUT_MS}).
 * @property {string} [cwd]                      Working directory for the child process.
 * @property {(skill: string) => boolean} [stopOnSkill]
 *   Called each time a skill fires; return `true` to end the run early. Used to
 *   avoid paying for a whole turn when only the trigger verdict matters.
 */

const STREAM_ARGS = ["--output-format", "stream-json", "--verbose"];

/**
 * Run `claude -p <prompt>` and collect the observable outcome.
 *
 * The stream schema (verified on Claude Code 2.1.x): assistant messages carry a
 * `message.content[]` array; a `tool_use` block named `"Skill"` holds the fired
 * skill in `input.skill`. The terminating `result` event carries `result`
 * (text), `total_cost_usd`, `num_turns`, and `is_error`.
 *
 * @param {string} prompt
 * @param {ClaudeOptions} [options]
 * @returns {Promise<import('./types.js').RunOutcome>}
 */
export async function runClaude(prompt, options = {}) {
  const child = spawn("claude", buildArgs(prompt, options), {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const collected = createCollector();
  let stoppedEarly = false;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? RUN_TIMEOUT_MS);

  const lines = readline.createInterface({ input: child.stdout });
  for await (const line of lines) {
    const event = parseJsonLine(line);
    if (!event) continue;

    for (const skill of skillsInEvent(event, collected.tools)) {
      collected.skills.add(skill);
      if (options.stopOnSkill?.(skill)) {
        stoppedEarly = true;
        child.kill("SIGKILL");
      }
    }
    if (event.type === "result") collected.absorbResult(event);
  }

  await once(child, "close");
  clearTimeout(timer);

  return collected.toOutcome({ suppressError: stoppedEarly || timedOut });
}

/**
 * Build the argument list for the child process.
 *
 * @param {string} prompt
 * @param {ClaudeOptions} options
 * @returns {string[]}
 */
function buildArgs(prompt, options) {
  const args = ["-p", prompt, ...STREAM_ARGS];
  if (options.model) args.push("--model", options.model);
  if (options.maxTurns) args.push("--max-turns", String(options.maxTurns));
  return args;
}

/**
 * Parse one NDJSON line, tolerating non-JSON noise.
 *
 * @param {string} line
 * @returns {Record<string, any> | null}
 */
function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Extract skill names from a stream event, recording every tool name seen.
 *
 * @param {Record<string, any>} event
 * @param {Set<string>} toolSink   Mutated with each tool name encountered.
 * @returns {string[]}             Skill names fired in this event.
 */
function skillsInEvent(event, toolSink) {
  const content = (event.message ?? event)?.content;
  if (!Array.isArray(content)) return [];
  /** @type {string[]} */
  const skills = [];
  for (const block of content) {
    if (block?.type !== "tool_use") continue;
    if (block.name) toolSink.add(block.name);
    if (block.name !== "Skill") continue;
    const raw = block.input?.skill ?? block.input?.skill_name ?? block.input?.command ?? "";
    const skill = String(raw).replace(/^\//, "");
    if (skill) skills.push(skill);
  }
  return skills;
}

/**
 * Accumulates state across the event stream and produces a {@link RunOutcome}.
 *
 * @returns {{
 *   skills: Set<string>,
 *   tools: Set<string>,
 *   absorbResult: (event: Record<string, any>) => void,
 *   toOutcome: (opts: { suppressError: boolean }) => import('./types.js').RunOutcome,
 * }}
 */
function createCollector() {
  const skills = new Set();
  const tools = new Set();
  let text = "";
  let costUsd = 0;
  let numTurns = 0;
  let isError = false;

  return {
    skills,
    tools,
    absorbResult(event) {
      text = event.result ?? text;
      costUsd = event.total_cost_usd ?? costUsd;
      numTurns = event.num_turns ?? numTurns;
      isError = Boolean(event.is_error);
    },
    toOutcome({ suppressError }) {
      return {
        text,
        skillsFired: [...skills],
        toolsUsed: [...tools],
        costUsd,
        numTurns,
        // an early stop or timeout is expected control flow, not a real failure
        isError: isError && !suppressError,
      };
    },
  };
}

/**
 * Resolve once an emitter fires an event.
 *
 * @param {import('node:events').EventEmitter} emitter
 * @param {string} event
 * @returns {Promise<void>}
 */
function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, () => resolve()));
}
