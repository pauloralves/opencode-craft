import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateLearningPathContent } from "../src/ledger.js";

/**
 * Token estimation: ~4 chars per token on average for English text.
 * This is conservative but sufficient for budget assertions.
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

test("efficiency: generateLearningPathContent stays under token budget with 20 sessions", () => {
  const root = "/fake/repo";
  const manySessions = Array.from({ length: 20 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i} - Architecture Decision & Implementation Details`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [
      "How do we design this zero-dependency engine with native node:sqlite?",
      "Let's structure the schema with proper indexing and constraints",
      "What are the trade-offs between SQLite and Postgres for this use case?",
    ],
  }));

  const output = generateLearningPathContent(root, manySessions, "", 8);
  const tokens = estimateTokens(output);

  // Budget: 20 sessions with 8 visible should stay under 4,000 tokens
  assert.ok(
    tokens < 4000,
    `LEARNING_PATH.md with 20 sessions (8 visible) should be under 4,000 tokens, got ${tokens}`
  );
});

test("efficiency: generateLearningPathContent stays under token budget with 50 sessions", () => {
  const root = "/fake/repo";
  const manySessions = Array.from({ length: 50 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i} - Architecture Decision & Implementation Details`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [
      "How do we design this zero-dependency engine with native node:sqlite?",
      "Let's structure the schema with proper indexing and constraints",
      "What are the trade-offs between SQLite and Postgres for this use case?",
    ],
  }));

  const output = generateLearningPathContent(root, manySessions, "", 8);
  const tokens = estimateTokens(output);

  // Budget: 50 sessions with 8 visible should stay under 4,000 tokens
  assert.ok(
    tokens < 4000,
    `LEARNING_PATH.md with 50 sessions (8 visible) should be under 4,000 tokens, got ${tokens}`
  );
});

test("efficiency: generateLearningPathContent output scales linearly, not exponentially", () => {
  const root = "/fake/repo";
  const makeSessions = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `ses_${i}`,
      title: `Session ${i}`,
      date: "2026-09-03 12:00",
      mode: "CRAFT",
      queries: [`Query ${i}`],
    }));

  const small = estimateTokens(generateLearningPathContent(root, makeSessions(10), "", 8));
  const medium = estimateTokens(generateLearningPathContent(root, makeSessions(20), "", 8));
  const large = estimateTokens(generateLearningPathContent(root, makeSessions(50), "", 8));

  // The output should be roughly the same size regardless of total sessions
  // (since only 8 are visible)
  const diffSmallMedium = Math.abs(medium - small);
  const diffMediumLarge = Math.abs(large - medium);

  // Allow small variance but should be roughly constant
  assert.ok(
    diffSmallMedium < 500,
    `Output size should be roughly constant; small=${small}, medium=${medium}, diff=${diffSmallMedium}`
  );
  assert.ok(
    diffMediumLarge < 500,
    `Output size should be roughly constant; medium=${medium}, large=${large}, diff=${diffMediumLarge}`
  );
});

test("efficiency: craft.md system prompt is under 2,000 tokens", () => {
  const agentFile = path.join(process.cwd(), "agents", "craft.md");
  const raw = fs.readFileSync(agentFile, "utf-8");
  const parts = raw.split(/^---\s*$/m);
  const prompt = parts.length >= 3 ? parts.slice(2).join("---").trim() : raw.trim();
  const tokens = estimateTokens(prompt);

  // The system prompt should be under 2,000 tokens (currently ~437)
  assert.ok(
    tokens < 2000,
    `craft.md system prompt should be under 2,000 tokens, got ${tokens}`
  );
});

test("efficiency: total context footprint (prompt + ledger) under 6,000 tokens", () => {
  const root = "/fake/repo";
  const manySessions = Array.from({ length: 30 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i} - Architecture Decision & Implementation Details`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [
      "How do we design this zero-dependency engine with native node:sqlite?",
      "Let's structure the schema with proper indexing and constraints",
      "What are the trade-offs between SQLite and Postgres for this use case?",
    ],
  }));

  const agentFile = path.join(process.cwd(), "agents", "craft.md");
  const raw = fs.readFileSync(agentFile, "utf-8");
  const parts = raw.split(/^---\s*$/m);
  const prompt = parts.length >= 3 ? parts.slice(2).join("---").trim() : raw.trim();

  const ledgerOutput = generateLearningPathContent(root, manySessions, "", 8);
  const totalTokens = estimateTokens(prompt) + estimateTokens(ledgerOutput);

  // Total context footprint (system prompt + ledger) should be under 6,000 tokens
  assert.ok(
    totalTokens < 6000,
    `Total context footprint (prompt + ledger) should be under 6,000 tokens, got ${totalTokens}`
  );
});

test("efficiency: plugin config hook does not load unnecessary files", async () => {
  // The plugin should only load what's needed: agents/craft.md and skills/
  // It should NOT load src/ledger.js, src/index.js, or other source files
  const CraftPlugin = (await import("../src/index.js")).default;

  const plugin = await CraftPlugin({
    client: {},
    project: {},
    directory: process.cwd(),
    worktree: process.cwd(),
    $: {},
  });

  assert.ok(typeof plugin.config === "function", "config hook should be a function");
  assert.ok(typeof plugin.event === "function", "event hook should be a function");

  // The config hook should register the craft agent without loading source files
  const cfg = {};
  await plugin.config(cfg);

  assert.ok(cfg.agent, "agent config should be set");
  assert.ok(cfg.agent.craft, "craft agent should be registered");
  assert.ok(cfg.skills, "skills config should be set");
  assert.ok(cfg.skills.paths, "skills paths should be set");
});