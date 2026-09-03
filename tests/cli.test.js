import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const CLI_BIN = path.resolve(process.cwd(), "bin", "opencode-craft.mjs");

test("cli: help output contains commands and description", () => {
  const output = execFileSync(process.execPath, [CLI_BIN, "help"], {
    encoding: "utf-8",
  });
  assert.ok(output.includes("opencode-craft"));
  assert.ok(output.includes("eject"));
  assert.ok(output.includes("sync"));
});

test("cli: eject scaffolds agents and skills into local directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-cli-test-"));
  try {
    const output = execFileSync(process.execPath, [CLI_BIN, "eject"], {
      cwd: tempDir,
      encoding: "utf-8",
    });

    const ejectedAgent = path.join(tempDir, ".opencode", "agents", "craft.md");
    const ejectedSkill = path.join(tempDir, ".opencode", "skills", "expand", "SKILL.md");

    assert.ok(fs.existsSync(ejectedAgent), "craft.md was not ejected");
    assert.ok(fs.existsSync(ejectedSkill), "skills were not ejected");

    const agentContent = fs.readFileSync(ejectedAgent, "utf-8");
    assert.ok(agentContent.includes("Principal Engineer / Technical Craft Lead"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
