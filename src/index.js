import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncLedger } from "./ledger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export const CraftPlugin = async (init = {}) => {
  // The factory-time context is unreliable: opencode 1.18.27's v1 loader
  // doesn't always populate worktree/directory, so falling back to cwd can
  // resolve to "/" and the sync silently no-ops. Keep the factory args, but
  // prefer the event payload directory (available on session.created) when
  // the factory context is missing.
  let targetDir = init.worktree || init.directory;

  const triggerSync = (dir = targetDir) => {
    try {
      if (!dir) return;
      // Fire-and-forget: the ledger must never block session startup.
      // The freshness guard in syncLedger makes repeated launches cheap.
      syncLedger(dir).catch(() => {});
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
        // The event payload carries the authoritative project directory;
        // update the target and sync without blocking.
        const eventDir = event?.directory || event?.project?.worktree || event?.project?.directory;
        if (eventDir) targetDir = eventDir;
        triggerSync();
      }
    }
  };
};

export default CraftPlugin;
