/**
 * The production {@link AgentRunner}: a thin wrapper around the `claude -p`
 * CLI. Owns the subprocess lifecycle (spawn, timeout, early kill); the stream
 * itself is interpreted by the pure collector in `stream.ts`.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";
import { RUN_TIMEOUT_MS } from "../core/constants.js";
import type { RunOutcome } from "../core/types.js";
import type { AgentRunner, AgentRunOptions } from "./agent-runner.js";
import { OutcomeCollector, parseStreamLine } from "./stream.js";

const STREAM_ARGS = ["--output-format", "stream-json", "--verbose"];

export class ClaudeCliRunner implements AgentRunner {
  /** Run `claude -p <prompt>` and collect the observable outcome. */
  async run(
    prompt: string,
    options: AgentRunOptions = {},
  ): Promise<RunOutcome> {
    const child = spawn("claude", buildArgs(prompt, options), {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Without a listener, a failed spawn (claude not installed) crashes the
    // process with an unhandled 'error' event mid-stream.
    let spawnError: NodeJS.ErrnoException | null = null;
    child.once("error", (err: NodeJS.ErrnoException) => {
      spawnError = err;
    });

    const collector = new OutcomeCollector();
    let stoppedEarly = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? RUN_TIMEOUT_MS);

    for await (const line of readline.createInterface({
      input: child.stdout,
    })) {
      const event = parseStreamLine(line);
      if (!event) continue;
      for (const skill of collector.ingest(event)) {
        if (options.stopOnSkill?.(skill)) {
          stoppedEarly = true;
          child.kill("SIGKILL");
        }
      }
    }

    await once(child, "close").catch(() => {}); // close still fires after a spawn error
    clearTimeout(timer);

    if (spawnError) {
      throw (spawnError as NodeJS.ErrnoException).code === "ENOENT"
        ? new Error(
            "`claude` CLI not found on PATH — install Claude Code first: https://claude.com/claude-code",
          )
        : spawnError;
    }

    return {
      text: collector.text,
      skillsFired: [...collector.skillsFired],
      toolsUsed: [...collector.toolsUsed],
      // SIGKILL on an early stop pre-empts the terminating `result` event, so
      // `costUsd` stays 0 — the caller renders the run total as a lower bound.
      costUsd: collector.costUsd,
      numTurns: collector.numTurns,
      stoppedEarly,
      // an early stop or timeout is expected control flow, not a real failure
      isError: collector.isError && !(stoppedEarly || timedOut),
    };
  }
}

/** Build the argument list for the child process. */
function buildArgs(prompt: string, options: AgentRunOptions): string[] {
  const args = ["-p", prompt, ...STREAM_ARGS];
  if (options.model) args.push("--model", options.model);
  if (options.maxTurns) args.push("--max-turns", String(options.maxTurns));
  if (options.disallowSkills) args.push("--disallowedTools", "Skill");
  if (options.isolate) args.push("--setting-sources", "project");
  return args;
}
