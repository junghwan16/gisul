/**
 * The seam between domain logic and the real `claude` CLI. The eval runner,
 * bench runner, and LLM judge all depend on this interface, never on the
 * subprocess adapter directly — tests substitute a fake and exercise every
 * scoring path offline.
 */

import type { RunOutcome } from "../core/types.js";

/** Options for a single agent run. */
export interface AgentRunOptions {
  /** Model alias for `--model`. */
  model?: string;
  /** Cap passed to `--max-turns`. */
  maxTurns?: number;
  /** Hard timeout for the run. */
  timeoutMs?: number;
  /** Working directory for the run. */
  cwd?: string;
  /**
   * Block the Skill tool (`--disallowedTools Skill`) — the "without skill"
   * arm of a bench run.
   */
  disallowSkills?: boolean;
  /**
   * Restrict discovery to the project at `cwd` (`--setting-sources project`),
   * so an isolated run sees exactly the skills materialized there — not the
   * installed `~/.claude/skills` or plugin skills.
   */
  isolate?: boolean;
  /**
   * Called each time a skill fires; return `true` to end the run early. Used
   * to avoid paying for a whole turn when only the trigger verdict matters.
   */
  stopOnSkill?: (skill: string) => boolean;
}

/** Runs one prompt headless and reports what happened. */
export interface AgentRunner {
  run(prompt: string, options?: AgentRunOptions): Promise<RunOutcome>;
}
