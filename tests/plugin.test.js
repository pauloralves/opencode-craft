import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CraftPlugin, syncLedger } from "../src/index.js";

test("plugin: exports CraftPlugin and syncLedger functions", () => {
  assert.strictEqual(typeof CraftPlugin, "function");
  assert.strictEqual(typeof syncLedger, "function");
});

test("plugin: config hook registers craft agent with emerald color and proper permissions", async () => {
  const plugin = await CraftPlugin({
    client: {},
    project: {},
    directory: process.cwd(),
    worktree: process.cwd(),
    $: null,
  });

  assert.strictEqual(typeof plugin.config, "function");
  assert.strictEqual(typeof plugin.event, "function");

  const cfg = {};
  await plugin.config(cfg);

  // Agent verification
  assert.ok(cfg.agent);
  assert.ok(cfg.agent.craft);
  assert.strictEqual(cfg.agent.craft.mode, "primary");
  assert.strictEqual(cfg.agent.craft.color, "#10b981");
  assert.strictEqual(cfg.agent.craft.permission.bash, "allow");
  assert.strictEqual(cfg.agent.craft.permission.edit, "allow");
  assert.strictEqual(cfg.agent.craft.permission.todowrite, "allow");
  assert.ok(cfg.agent.craft.prompt.length > 50);

  // Skills verification
  assert.ok(cfg.skills);
  assert.ok(Array.isArray(cfg.skills.paths));
  assert.ok(cfg.skills.paths.some((p) => p.endsWith("skills")));
});

test("plugin: config hook respects user existing agent configuration", async () => {
  const plugin = await CraftPlugin({
    client: {},
    project: {},
    directory: process.cwd(),
    worktree: process.cwd(),
    $: null,
  });

  const customAgent = { mode: "subagent", description: "custom" };
  const cfg = {
    agent: {
      craft: customAgent,
    },
  };

  await plugin.config(cfg);
  assert.strictEqual(cfg.agent.craft, customAgent);
});
