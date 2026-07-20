import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectSkillDirs,
  materializeProject,
  removeProject,
  resolveSkillDir,
} from "../src/suite/isolate.js";
import { withTempDir, write } from "./helpers.js";

const SKILL_MD = "---\nname: sql\ndescription: d\n---\nbody\n";

describe("resolveSkillDir", () => {
  it("accepts a skill directory or its SKILL.md, naming it from frontmatter", () => {
    withTempDir((dir) => {
      const skillMd = write(dir, "my-checkout/SKILL.md", SKILL_MD);
      const fromDir = resolveSkillDir(path.dirname(skillMd));
      expect(fromDir).toEqual({ name: "sql", dir: path.dirname(skillMd) });
      expect(resolveSkillDir(skillMd)).toEqual(fromDir);
    });
  });

  it("falls back to the folder name when frontmatter has no name", () => {
    withTempDir((dir) => {
      write(dir, "tidy/SKILL.md", "no frontmatter");
      expect(resolveSkillDir(path.join(dir, "tidy")).name).toBe("tidy");
    });
  });

  it("rejects a path without a SKILL.md", () => {
    withTempDir((dir) => {
      expect(() => resolveSkillDir(dir)).toThrow(/no SKILL\.md/);
      expect(() => resolveSkillDir(path.join(dir, "missing"))).toThrow(
        /no SKILL\.md/,
      );
    });
  });
});

describe("collectSkillDirs", () => {
  it("merges local and installed skills, local winning on a name clash", () => {
    withTempDir((root) =>
      withTempDir((installed) => {
        write(root, "skills/sql/SKILL.md", SKILL_MD);
        write(installed, "sql/SKILL.md", SKILL_MD);
        write(installed, "tidy/SKILL.md", "x");
        write(installed, "not-a-skill/README.md", "x");

        const skills = collectSkillDirs(root, installed);
        expect(skills.get("sql")).toBe(path.join(root, "skills", "sql"));
        expect(skills.get("tidy")).toBe(path.join(installed, "tidy"));
        expect(skills.has("not-a-skill")).toBe(false);
      }),
    );
  });

  it("tolerates a missing installed root", () => {
    withTempDir((root) => {
      write(root, "sql/SKILL.md", SKILL_MD);
      const skills = collectSkillDirs(root, path.join(root, "nope"));
      expect([...skills.keys()]).toEqual(["sql"]);
    });
  });

  it("keys by frontmatter name, so ablation can't miss an odd checkout folder", () => {
    withTempDir((root) => {
      write(root, "wip-checkout/SKILL.md", SKILL_MD); // frontmatter name: sql
      const skills = collectSkillDirs(root, "/nonexistent");
      expect([...skills.entries()]).toEqual([
        ["sql", path.join(root, "wip-checkout")],
      ]);
    });
  });
});

describe("materializeProject", () => {
  it("copies each skill dir (including references) into .claude/skills", () => {
    withTempDir((root) => {
      write(root, "sql/SKILL.md", SKILL_MD);
      write(root, "sql/references/guide.md", "ref");
      const project = materializeProject(
        collectSkillDirs(root, "/nonexistent"),
      );
      try {
        expect(
          fs.readFileSync(
            path.join(project, ".claude", "skills", "sql", "SKILL.md"),
            "utf8",
          ),
        ).toBe(SKILL_MD);
        expect(
          fs.existsSync(
            path.join(
              project,
              ".claude",
              "skills",
              "sql",
              "references",
              "guide.md",
            ),
          ),
        ).toBe(true);
      } finally {
        removeProject(project);
      }
      expect(fs.existsSync(project)).toBe(false);
    });
  });
});
