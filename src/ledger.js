import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

export const DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/**
 * Traverses up directory tree to find project root (containing .git, package.json, etc.)
 */
export function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (
      fs.existsSync(path.join(current, "AGENTS.md")) ||
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, ".opencode")) ||
      fs.existsSync(path.join(current, "package.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

/**
 * Attempts to load native node:sqlite DatabaseSync (available in Node.js >= 22.5.0)
 */
async function getNativeSqlite() {
  try {
    const sqlite = await import("node:sqlite");
    if (sqlite.DatabaseSync) {
      return sqlite.DatabaseSync;
    }
  } catch {
    // node:sqlite not supported in this runtime
  }
  return null;
}

/**
 * Query sessions using native node:sqlite DatabaseSync
 */
function fetchWithNativeSqlite(DatabaseSync, targetDir) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const sessionStmt = db.prepare(`
      SELECT id, slug, directory, title, agent, time_created, time_updated
      FROM session
      WHERE directory = ? OR directory LIKE ?
      ORDER BY time_created ASC
    `);
    const sessions = sessionStmt.all(targetDir, `${targetDir}/%`);

    const partStmt = db.prepare(`
      SELECT data
      FROM part
      WHERE session_id = ?
      ORDER BY time_created ASC
    `);

    const results = [];
    for (const s of sessions) {
      const parts = partStmt.all(s.id);
      const userPrompts = [];
      const assistantSnippets = [];

      for (const row of parts) {
        try {
          const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (data && data.type === "text" && typeof data.text === "string") {
            const txt = data.text.trim();
            if (txt) {
              if (userPrompts.length === assistantSnippets.length) {
                userPrompts.push(txt);
              } else {
                assistantSnippets.push(txt);
              }
            }
          }
        } catch {
          // ignore corrupted part JSON
        }
      }

      const dt = formatTimestamp(s.time_created);
      const mode = (s.agent || "build").toUpperCase();
      const queries = userPrompts
        .slice(0, 3)
        .map((q) => q.replace(/\r?\n/g, " ").slice(0, 120));

      results.push({
        id: s.id,
        title: s.title || "Session",
        date: dt,
        mode,
        queries,
      });
    }

    return results;
  } finally {
    db.close();
  }
}

/**
 * Query sessions using system sqlite3 CLI with JSON output (zero npm dependencies)
 */
function fetchWithSqliteCli(targetDir) {
  const escapedDir = targetDir.replace(/'/g, "''");
  const sessionQuery = `SELECT id, slug, directory, title, agent, time_created, time_updated FROM session WHERE directory = '${escapedDir}' OR directory LIKE '${escapedDir}/%' ORDER BY time_created ASC;`;

  const sessionOutput = execFileSync("sqlite3", ["-json", DB_PATH, sessionQuery], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const sessions = JSON.parse(sessionOutput || "[]");
  const results = [];

  for (const s of sessions) {
    const escapedId = String(s.id).replace(/'/g, "''");
    const partQuery = `SELECT data FROM part WHERE session_id = '${escapedId}' ORDER BY time_created ASC;`;
    let parts = [];
    try {
      const partOutput = execFileSync("sqlite3", ["-json", DB_PATH, partQuery], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      parts = JSON.parse(partOutput || "[]");
    } catch {
      parts = [];
    }

    const userPrompts = [];
    const assistantSnippets = [];

    for (const row of parts) {
      try {
        const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        if (data && data.type === "text" && typeof data.text === "string") {
          const txt = data.text.trim();
          if (txt) {
            if (userPrompts.length === assistantSnippets.length) {
              userPrompts.push(txt);
            } else {
              assistantSnippets.push(txt);
            }
          }
        }
      } catch {
        // ignore corrupted part JSON
      }
    }

    const dt = formatTimestamp(s.time_created);
    const mode = (s.agent || "build").toUpperCase();
    const queries = userPrompts
      .slice(0, 3)
      .map((q) => q.replace(/\r?\n/g, " ").slice(0, 120));

    results.push({
      id: s.id,
      title: s.title || "Session",
      date: dt,
      mode,
      queries,
    });
  }

  return results;
}

/**
 * Query sessions using Python fallback
 */
function fetchWithPythonFallback(projectRoot, scriptPath) {
  if (fs.existsSync(scriptPath)) {
    execFileSync("python3", [scriptPath, "--dir", projectRoot], {
      stdio: "ignore",
    });
    return true;
  }
  return false;
}

function formatTimestamp(timestampMs) {
  const d = new Date(Number(timestampMs));
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function generateLearningPathContent(projectRoot, sessionLogs, existingContent = "") {
  const now = formatTimestamp(Date.now());
  const lines = [
    "# Project Learning Path & Knowledge Ledger",
    "",
    "> Auto-synced across OpenCode sessions. Captures architectural milestones, design trade-offs, and interview talking points.",
    "",
    "## Active Project Context",
    `- **Repository Path**: \`${projectRoot}\``,
    `- **Last Updated**: ${now}`,
    `- **Total Recorded Sessions**: ${sessionLogs.length}`,
    "",
    "## Session History & Architectural Log",
    "",
  ];

  if (sessionLogs.length === 0) {
    lines.push("No recorded sessions yet in this project directory.");
  } else {
    for (const s of sessionLogs) {
      lines.push(`### [${s.mode}] ${s.title} (${s.date})`);
      if (s.queries && s.queries.length > 0) {
        lines.push("**Key Inquiries & Themes:**");
        for (const q of s.queries) {
          lines.push(`- ${q}`);
        }
      }
      lines.push("");
    }
  }

  let existingCustom = "";
  if (existingContent && existingContent.includes("## Custom Notes & Interview Rationale")) {
    existingCustom = existingContent.split("## Custom Notes & Interview Rationale")[1];
  }

  lines.push("## Custom Notes & Interview Rationale");
  if (existingCustom && existingCustom.trim()) {
    lines.push(existingCustom.trim());
  } else {
    lines.push("- *(Notes, interview talking points, or architectural ideas kept here persist across syncs)*");
  }
  lines.push("");

  return lines.join("\n");
}

export async function syncLedger(targetDir = process.cwd(), options = {}) {
  const projectRoot = findProjectRoot(targetDir);
  const outputPath = path.join(projectRoot, "LEARNING_PATH.md");

  if (!fs.existsSync(DB_PATH)) {
    if (options.verbose) {
      console.warn(`[opencode-craft] Database not found at ${DB_PATH}`);
    }
    return false;
  }

  let sessionLogs = null;

  // 1. Try native node:sqlite
  const DatabaseSync = await getNativeSqlite();
  if (DatabaseSync) {
    try {
      sessionLogs = fetchWithNativeSqlite(DatabaseSync, projectRoot);
    } catch (err) {
      if (options.verbose) {
        console.warn("[opencode-craft] node:sqlite query failed:", err.message);
      }
    }
  }

  // 2. Try sqlite3 CLI
  if (sessionLogs === null) {
    try {
      sessionLogs = fetchWithSqliteCli(projectRoot);
    } catch (err) {
      if (options.verbose) {
        console.warn("[opencode-craft] sqlite3 CLI query failed:", err.message);
      }
    }
  }

  // 3. Fallback to Python if both failed
  if (sessionLogs === null) {
    const pythonScript = options.pythonScript || path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..", "scripts", "sync_ledger.py");
    try {
      const ok = fetchWithPythonFallback(projectRoot, pythonScript);
      if (ok) return true;
    } catch {
      // ignore
    }
    return false;
  }

  // Write out LEARNING_PATH.md
  let existingContent = "";
  if (fs.existsSync(outputPath)) {
    try {
      existingContent = fs.readFileSync(outputPath, "utf-8");
    } catch {
      // ignore read error
    }
  }

  const newContent = generateLearningPathContent(projectRoot, sessionLogs, existingContent);
  fs.writeFileSync(outputPath, newContent, "utf-8");
  return true;
}
