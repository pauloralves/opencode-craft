import test from "node:test";
import assert from "node:assert/strict";
import { generateLearningPathContent } from "../src/ledger.js";

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

test("graduated density: recent sessions get full detail with queries", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, sessions, "", 5);

  // Last 5 sessions (5-9) should appear as full headers with queries
  for (let i = 5; i < 10; i++) {
    assert.ok(
      output.includes(`### [CRAFT] Session ${i}`),
      `Recent session ${i} should have full header`
    );
    assert.ok(
      output.includes(`- Query ${i}`),
      `Recent session ${i} should include query`
    );
  }
});

test("graduated density: mid sessions get title-only, no queries", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 25 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, sessions, "", 5);

  // With 25 sessions and maxSessions=5: 20 older sessions
  // Mid zone: last 12 of older (sessions 8-19), Ancient: sessions 0-7
  // So mid zone contains sessions 8-19
  for (let i = 8; i < 20; i++) {
    assert.ok(
      output.includes(`- **CRAFT**: Session ${i}`),
      `Mid session ${i} should have title-only format`
    );
    assert.ok(
      !output.includes(`### [CRAFT] Session ${i}`),
      `Mid session ${i} should NOT have full header`
    );
    assert.ok(
      !output.includes(`- Query ${i}`),
      `Mid session ${i} should NOT include query`
    );
  }
});

test("graduated density: ancient sessions collapse to single aggregate line", () => {
  const root = "/fake/repo";
  // 50 sessions: 5 recent + 12 mid + 33 ancient
  const sessions = Array.from({ length: 50 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: `2026-09-0${String(i % 9 + 1)} 12:00`,
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, sessions, "", 5);

  // Should have an aggregate line for ancient sessions
  assert.ok(
    output.includes("*") && output.includes("earlier sessions"),
    "Should have aggregate line for ancient sessions"
  );
  // Total count should still be correct
  assert.ok(output.includes("- **Total Recorded Sessions**: 50"));
  // Recent sessions should still be full detail
  assert.ok(output.includes("### [CRAFT] Session 49"));
});

test("graduated density: output stays under strict token budget with 100 sessions", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 100 }, (_, i) => ({
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

  const output = generateLearningPathContent(root, sessions, "", 8);
  const tokens = estimateTokens(output);

  // With 100 sessions, graduated density should keep output under 6,000 tokens
  // (recent 8 full + mid 12 title-only + ancient 80 collapsed = ~5,500 tokens max)
  assert.ok(
    tokens < 6000,
    `LEARNING_PATH.md with 100 sessions should be under 6,000 tokens, got ${tokens}`
  );
});

test("graduated density: output grows sub-linearly with session count", () => {
  const root = "/fake/repo";
  const makeSessions = (n) =>
    Array.from({ length: n }, (_, i) => ({
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

  const t10 = estimateTokens(generateLearningPathContent(root, makeSessions(10), "", 8));
  const t50 = estimateTokens(generateLearningPathContent(root, makeSessions(50), "", 8));
  const t100 = estimateTokens(generateLearningPathContent(root, makeSessions(100), "", 8));

  // 10 sessions: ~10 full entries
  // 50 sessions: 8 full + 12 title-only + 30 collapsed
  // 100 sessions: 8 full + 12 title-only + 80 collapsed
  // Growth should be sub-linear: t100 should be less than 2x t10
  assert.ok(
    t100 < t10 * 2,
    `Output should grow sub-linearly: 100 sessions (${t100} tokens) should be < 2x 10 sessions (${t10} tokens)`
  );
});

test("graduated density: custom notes are preserved across all density zones", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const existing = `# Project Learning Path & Knowledge Ledger

## Custom Notes & Interview Rationale
- Interview talking point: chose node:sqlite over native add-ons to eliminate node-gyp compilation hurdles
- Another important architectural decision to preserve
`;

  const output = generateLearningPathContent(root, sessions, existing, 8);

  assert.ok(
    output.includes("chose node:sqlite over native add-ons to eliminate node-gyp compilation hurdles"),
    "Custom notes should be preserved"
  );
  assert.ok(
    output.includes("Another important architectural decision to preserve"),
    "All custom notes should be preserved"
  );
});

test("graduated density: mid zone truncates long titles", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 25 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i} - ${"Architecture Decision & Implementation Details ".repeat(5)}`,
    date: "2026-09-03 12:00",
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, sessions, "", 5);

  // Mid zone titles should be truncated: title portion (after "- **CRAFT**: " and before " (date)")
  // must not exceed 70 chars including trailing "..."
  const midLines = output.split("\n").filter(l => l.startsWith("- **CRAFT**:"));
  for (const line of midLines) {
    // Extract the title portion: between "- **CRAFT**: " and " (date)"
    const match = line.match(/^- \*\*CRAFT\*\*:\s*(.+?)\s*\(\d{4}/);
    if (match) {
      const title = match[1];
      assert.ok(
        title.length <= 70,
        `Mid zone title should be <=70 chars, got "${title.slice(0, 75)}..." (${title.length} chars)`
      );
      // Long titles should end with "..."
      if (title.length === 70) {
        assert.ok(
          title.endsWith("..."),
          `Truncated title should end with "...": "${title.slice(-5)}"`
        );
      }
    }
  }
});

test("graduated density: ancient zone preserves date range", () => {
  const root = "/fake/repo";
  const sessions = Array.from({ length: 50 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    date: `2026-0${String(Math.floor(i / 10) + 1)}-0${String((i % 10) + 1)} 12:00`,
    mode: "CRAFT",
    queries: [`Query ${i}`],
  }));

  const output = generateLearningPathContent(root, sessions, "", 5);

  // Ancient zone should reference first and last dates
  assert.ok(
    output.includes("earlier sessions") && output.includes("to"),
    "Ancient zone should preserve date range"
  );
});