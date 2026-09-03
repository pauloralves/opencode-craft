import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

// Event-driven syncs (session.created / session.idle) skip the ledger entirely
// when it was written within this window. Avoids re-reading multi-MB part
// payloads on every launch and every idle event. Manual `sync` passes force.
const SYNC_FRESHNESS_MS = 5 * 60 * 1000;

// Part payloads can be tens of MB; the execFile default maxBuffer (1MB) would
// throw on real projects. Generous ceiling, and SQL-side filtering below keeps
// actual transfer small.
const MAX_BUFFER = 256 * 1024 * 1024;

// Only text parts (user prompts / assistant replies) matter for the ledger.
// Filtering in SQL keeps tool output, steps, and image payloads out of the pipe.
const TEXT_PARTS_SQL = `json_extract(p.data, '$.type') = 'text'`;

/**
 * Traverses up directory tree to find project root (containing .git, package.json, etc.)
 */
export function findProjectRoot(startDir = process.cwd()) {
  const dirPath = typeof startDir === "string"
    ? startDir
    : (startDir?.worktree || startDir?.directory || process.cwd());
  let current = path.resolve(dirPath);
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
 * Build the ledger entry for one session from its (already text-filtered) parts.
 * Shared by the native and sqlite3-CLI backends.
 */
function buildSessionResult(s, rows) {
  const userPrompts = [];
  const assistantSnippets = [];

  for (const row of rows) {
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

  return {
    id: s.id,
    title: s.title || "Session",
    date: formatTimestamp(s.time_created),
    mode: (s.agent || "build").toUpperCase(),
    queries: userPrompts
      .slice(0, 3)
      .map((q) => q.replace(/\r?\n/g, " ").slice(0, 120)),
  };
}

/**
 * Fetch all text parts for the project's sessions in a single query.
 * Returns a Map<session_id, rows> preserving part order.
 */
function groupPartsBySession(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const sid = row.sid ?? row.session_id;
    const list = bySession.get(sid);
    if (list) list.push(row);
    else bySession.set(sid, [row]);
  }
  return bySession;
}

/**
 * Query sessions using native node:sqlite DatabaseSync (Node.js >= 22.5.0).
 * Synchronous by design of the API; freshness guard keeps this off the hot path.
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

    let parts = [];
    if (sessions.length > 0) {
      const partStmt = db.prepare(`
        SELECT p.session_id AS sid, p.data AS data
        FROM part p
        JOIN session s ON s.id = p.session_id
        WHERE (s.directory = ? OR s.directory LIKE ?)
          AND ${TEXT_PARTS_SQL}
        ORDER BY p.time_created ASC
      `);
      parts = partStmt.all(targetDir, `${targetDir}/%`);
    }

    const bySession = groupPartsBySession(parts);
    return sessions.map((s) => buildSessionResult(s, bySession.get(s.id) || []));
  } finally {
    db.close();
  }
}

/**
 * Query sessions using system sqlite3 CLI with JSON output (zero npm dependencies).
 * Async: never blocks the runtime event loop while processes run.
 */
async function fetchWithSqliteCli(targetDir) {
  const escapedDir = targetDir.replace(/'/g, "''");
  const sessionQuery = `SELECT id, slug, directory, title, agent, time_created, time_updated FROM session WHERE directory = '${escapedDir}' OR directory LIKE '${escapedDir}/%' ORDER BY time_created ASC;`;

  const sessionRes = await execFileAsync("sqlite3", ["-json", DB_PATH, sessionQuery], {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
  });
  const sessions = JSON.parse(sessionRes.stdout || "[]");

  // Single JOIN for all parts instead of one process spawn per session.
  let parts = [];
  if (sessions.length > 0) {
    try {
      const partQuery = `SELECT p.session_id AS sid, p.data AS data FROM part p JOIN session s ON s.id = p.session_id WHERE (s.directory = '${escapedDir}' OR s.directory LIKE '${escapedDir}/%') AND ${TEXT_PARTS_SQL} ORDER BY p.time_created ASC;`;
      const partRes = await execFileAsync("sqlite3", ["-json", DB_PATH, partQuery], {
        encoding: "utf-8",
        maxBuffer: MAX_BUFFER,
      });
      parts = JSON.parse(partRes.stdout || "[]");
    } catch {
      parts = [];
    }
  }

  const bySession = groupPartsBySession(parts);
  return sessions.map((s) => buildSessionResult(s, bySession.get(s.id) || []));
}

/**
 * Query sessions using Python fallback
 */
async function fetchWithPythonFallback(projectRoot, scriptPath) {
  if (fs.existsSync(scriptPath)) {
    await execFileAsync("python3", [scriptPath, "--dir", projectRoot], {
      stdio: "ignore",
      maxBuffer: MAX_BUFFER,
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

/**
 * Generates LEARNING_PATH.md content with graduated density:
 * - Recent (last maxSessions): full entries with query summaries
 * - Mid (next 12): title-only, truncated, no queries
 * - Ancient (everything older): single aggregate line preserving date range
 */
const MID_HISTORY_LIMIT = 12;

export function generateLearningPathContent(projectRoot, sessionLogs, existingContent = "", maxSessions = 8) {
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
    // --- Graduated Density Compression ---
    // Recent: full detail (title, date, key inquiries)
    // Mid: title-only, truncated, no queries
    // Ancient: single aggregate line preserving date range

    const recent = sessionLogs.slice(-maxSessions);
    const older = sessionLogs.slice(0, sessionLogs.length - maxSessions);
    const mid = older.slice(-MID_HISTORY_LIMIT);
    const ancient = older.slice(0, older.length - MID_HISTORY_LIMIT);

    // Ancient aggregate: one line for everything beyond the mid window
    if (ancient.length > 0) {
      const firstDate = ancient[0].date;
      const lastDate = ancient[ancient.length - 1].date;
      lines.push(`*${ancient.length} earlier sessions (${firstDate} to ${lastDate}) summarized in the OpenCode database*`);
      lines.push("");
    }

    // Mid zone: title-only entries (truncated), no query text
    for (const s of mid) {
      const truncated = s.title.length > 70 ? s.title.slice(0, 67) + "..." : s.title;
      lines.push(`- **${s.mode}**: ${truncated} (${s.date})`);
    }
    if (mid.length > 0) {
      lines.push("");
    }

    // Recent zone: full detail with key inquiries
    for (const s of recent) {
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
  const resolvedTarget = typeof targetDir === "string"
    ? targetDir
    : (targetDir?.worktree || targetDir?.directory || process.cwd());
  const projectRoot = findProjectRoot(resolvedTarget);
  const outputPath = path.join(projectRoot, "LEARNING_PATH.md");

  // Never write a ledger at the filesystem root (e.g. legacy function
  // invocation with no directory context resolving cwd to "/").
  if (projectRoot === path.parse(projectRoot).root) {
    return false;
  }

  // Event-driven syncs skip when the ledger is fresh. Manual CLI syncs pass
  // `force: true` and always run.
  if (!options.force) {
    try {
      const stat = fs.statSync(outputPath);
      if (Date.now() - stat.mtimeMs < SYNC_FRESHNESS_MS) {
        return false;
      }
    } catch {
      // no ledger yet — sync normally
    }
  }

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
      sessionLogs = await fetchWithSqliteCli(projectRoot);
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
      const ok = await fetchWithPythonFallback(projectRoot, pythonScript);
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
  try {
    fs.writeFileSync(outputPath, newContent, "utf-8");
  } catch (err) {
    if (options.verbose) {
      console.warn(`[opencode-craft] failed to write ${outputPath}:`, err.message);
    }
    return false;
  }
  return true;
}
