import test from "node:test";
import assert from "node:assert/strict";
import mod, { CraftPlugin } from "../src/index.js";
import * as ledger from "../src/ledger.js";

test("plugin: exports CraftPlugin (named + default) but no stray functions", async () => {
  assert.strictEqual(typeof CraftPlugin, "function");
  assert.strictEqual(mod, CraftPlugin);
  // Every named export must be the plugin itself. Legacy top-level function
  // exports (like syncLedger) get invoked as separate plugins by opencode.
  const named = Object.keys(await import("../src/index.js")).sort();
  assert.deepEqual(named, ["CraftPlugin", "default"]);
  assert.strictEqual(typeof ledger.syncLedger, "function");
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
