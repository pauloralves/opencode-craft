import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncLedger } from "./ledger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export const CraftPlugin = async ({ client, project, directory, worktree, $ }) => {
  const targetDir = worktree || directory || process.cwd();

  const triggerSync = () => {
    try {
      // Fire-and-forget: the ledger must never block session startup.
      // The freshness guard in syncLedger makes repeated launches cheap.
      syncLedger(targetDir).catch(() => {});
    } catch {
      // Non-blocking best-effort ledger update
    }
  };

  // Sync once at boot so LEARNING_PATH.md exists as soon as OpenCode opens
  // in a project — even before the first session is started. The freshness
  // guard keeps this a ~1ms stat check on subsequent launches.
  triggerSync();

  return {
    config: async (cfg) => {
      // 1. Auto-discover packaged skills
      const skillsDir = path.join(packageRoot, "skills");
      if (fs.existsSync(skillsDir)) {
        cfg.skills = cfg.skills || {};
        const existingPaths = cfg.skills.paths || [];
        if (!existingPaths.includes(skillsDir)) {
          cfg.skills.paths = [...existingPaths.filter(p => typeof p === 'string'), skillsDir];
        }
      }

      // 2. Auto-register craft agent if not explicitly defined
      cfg.agent = cfg.agent || {};
      if (!cfg.agent.craft) {
        const agentFile = path.join(packageRoot, "agents", "craft.md");
        let prompt = "";
        if (fs.existsSync(agentFile)) {
          const raw = fs.readFileSync(agentFile, "utf-8");
          const parts = raw.split(/^---\s*$/m);
          prompt = parts.length >= 3 ? parts.slice(2).join("---").trim() : raw.trim();
        }

        cfg.agent.craft = {
          mode: "primary",
          color: "#10b981",
          description: "Senior pair programmer and craft lead: builds at high velocity while coaching system architecture, trade-offs, and interview readiness.",
          prompt,
          permission: {
            edit: "allow",
            bash: "allow",
            read: "allow",
            glob: "allow",
            grep: "allow",
            todowrite: "allow",
            question: "allow",
            skill: "allow"
          }
        };
      }
    },

    event: async ({ event }) => {
      if (event?.type === "session.created" || event?.type === "session.idle") {
        // Do NOT await triggerSync — opencode awaits this hook, and the
        // ledger sync (DB reads, process spawns) would delay startup.
        triggerSync();
      }
    }
  };
};

export default CraftPlugin;
