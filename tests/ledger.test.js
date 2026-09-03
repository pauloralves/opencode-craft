import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { findProjectRoot, generateLearningPathContent, syncLedger } from "../src/ledger.js";

test("findProjectRoot: identifies directory containing package.json or .git", () => {
  const root = findProjectRoot(process.cwd());
  assert.ok(fs.existsSync(path.join(root, "package.json")));
  assert.strictEqual(root, path.resolve(process.cwd()));
});

test("generateLearningPathContent: handles empty session list cleanly", () => {
  const root = "/fake/repo";
  const output = generateLearningPathContent(root, []);

  assert.ok(output.includes("# Project Learning Path & Knowledge Ledger"));
  assert.ok(output.includes(`- **Repository Path**: \`${root}\``));
  assert.ok(output.includes("- **Total Recorded Sessions**: 0"));
  assert.ok(output.includes("No recorded sessions yet in this project directory."));
  assert.ok(output.includes("## Custom Notes & Interview Rationale"));
});

test("generateLearningPathContent: formats sessions and preserves custom notes", () => {
  const root = "/fake/repo";
  const mockSessions = [
    {
      id: "ses_1",
      title: "First Architecture Spike",
      date: "2026-09-03 10:00",
      mode: "CRAFT",
      queries: ["How do we design this zero-dependency engine?", "Let's structure the schema"],
    },
    {
      id: "ses_2",
      title: "Performance Optimization",
      date: "2026-09-03 11:30",
      mode: "BUILD",
      queries: ["Benchmark SQLite queries"],
    },
  ];

  const existingFile = `# Project Learning Path & Knowledge Ledger

## Custom Notes & Interview Rationale
- Crucial interview talking point: chose node:sqlite over native add-ons to eliminate node-gyp compilation hurdles.
`;

  const output = generateLearningPathContent(root, mockSessions, existingFile);

  assert.ok(output.includes("### [CRAFT] First Architecture Spike (2026-09-03 10:00)"));
  assert.ok(output.includes("- How do we design this zero-dependency engine?"));
  assert.ok(output.includes("### [BUILD] Performance Optimization (2026-09-03 11:30)"));
  assert.ok(output.includes("- Benchmark SQLite queries"));
  assert.ok(output.includes("- **Total Recorded Sessions**: 2"));
  // Custom notes must be preserved!
  assert.ok(
    output.includes("chose node:sqlite over native add-ons to eliminate node-gyp compilation hurdles.")
  );
});

test("generateLearningPathContent: bounds visible session history to prevent context bloat", () => {
  const root = "/fake/repo";
  const manySessions = Array.from({ length: 15 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, manySessions, "", 5);

  assert.ok(output.includes("- **Total Recorded Sessions**: 15"));
  assert.ok(output.includes("*(10 earlier session(s) archived to maintain optimal context window)*"));
  // Only the last 5 sessions should appear in detail
  assert.ok(output.includes("### [CRAFT] Session 14"));
  assert.ok(output.includes("### [CRAFT] Session 10"));
  assert.ok(!output.includes("### [CRAFT] Session 0"));
});

test("syncLedger: executes non-blocking and returns boolean without throwing on missing db", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "craft-test-"));
  try {
    const res = await syncLedger(tempDir);
    assert.strictEqual(typeof res, "boolean");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
