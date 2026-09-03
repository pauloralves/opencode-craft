#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncLedger } from "../src/ledger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const command = args[0] || "help";

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mopencode-craft\x1b[0m — Senior pair programmer & craftsmanship ledger for OpenCode

\x1b[1mUSAGE\x1b[0m
  $ npx opencode-craft <command> [options]

\x1b[1mCOMMANDS\x1b[0m
  \x1b[32meject\x1b[0m, \x1b[32minit\x1b[0m    Scaffold craft agent and skills as editable local markdown files
  \x1b[32msync\x1b[0m            Manually update the LEARNING_PATH.md knowledge ledger
  \x1b[32mhelp\x1b[0m            Show this help message

\x1b[1mOPTIONS\x1b[0m
  --global, -g     Target ~/.config/opencode/ instead of project-local .opencode/

\x1b[1mZERO-TOUCH USAGE (NO EJECT NEEDED)\x1b[0m
  Add to your opencode.json or ~/.config/opencode/opencode.jsonc:
  {
    "plugin": ["opencode-craft"]
  }
`);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function handleEject() {
  const isGlobal = args.includes("--global") || args.includes("-g");
  const targetBase = isGlobal
    ? path.join(os.homedir(), ".config", "opencode")
    : path.join(process.cwd(), ".opencode");

  const agentsDest = path.join(targetBase, "agents");
  const skillsDest = path.join(targetBase, "skills");

  fs.mkdirSync(agentsDest, { recursive: true });
  fs.mkdirSync(skillsDest, { recursive: true });

  // 1. Copy craft agent
  const agentSrc = path.join(packageRoot, "agents", "craft.md");
  const agentTarget = path.join(agentsDest, "craft.md");
  fs.copyFileSync(agentSrc, agentTarget);
  console.log(`\x1b[32m✔\x1b[0m Created ${agentTarget}`);

  // 2. Copy skills
  const skillsSrc = path.join(packageRoot, "skills");
  copyDirRecursive(skillsSrc, skillsDest);
  console.log(`\x1b[32m✔\x1b[0m Copied skills into ${skillsDest}`);

  console.log(`
\x1b[1m\x1b[32mDone!\x1b[0m You now have full local control over the craft agent and skills.
Restart OpenCode to begin using the @craft agent.
`);
}

async function handleSync() {
  const targetDir = process.cwd();
  console.log(`Updating LEARNING_PATH.md for ${targetDir}...`);
  try {
    const success = await syncLedger(targetDir, { verbose: true, force: true });
    if (success) {
      console.log(`\x1b[32m✔\x1b[0m LEARNING_PATH.md synced successfully.`);
    } else {
      console.error(`\x1b[31m✖\x1b[0m Could not update LEARNING_PATH.md.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m✖\x1b[0m Failed to sync ledger:`, err.message);
    process.exit(1);
  }
}

async function main() {
  switch (command) {
    case "eject":
    case "init":
      handleEject();
      break;
    case "sync":
      await handleSync();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
