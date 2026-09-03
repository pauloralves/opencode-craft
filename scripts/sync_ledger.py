#!/usr/bin/env python3
"""
sync_ledger.py

Reads OpenCode session history from SQLite (~/.local/share/opencode/opencode.db)
for a given target directory, extracts milestones, topics, and architectural
decisions across all agent modes (craft, build, plan, etc.), and produces or updates
a concise LEARNING_PATH.md right in the project root.
"""

import sys
import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path.home() / ".local/share/opencode/opencode.db"

def find_project_root(start_dir: str) -> Path:
    p = Path(start_dir).resolve()
    for parent in [p] + list(p.parents):
        if (
            (parent / "AGENTS.md").exists()
            or (parent / ".git").exists()
            or (parent / ".opencode").exists()
            or (parent / "package.json").exists()
        ):
            return parent
    return p

def fetch_sessions_and_messages(target_dir: str):
    if not DB_PATH.exists():
        return []

    try:
        # Connect read-only to avoid lock conflicts
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Query all sessions in this directory, oldest to newest
        cursor.execute("""
            SELECT id, slug, directory, title, agent, time_created, time_updated
            FROM session
            WHERE directory = ? OR directory LIKE ?
            ORDER BY time_created ASC
        """, (target_dir, f"{target_dir}%"))

        sessions = cursor.fetchall()
        results = []

        for s in sessions:
            s_id = s["id"]
            cursor.execute("""
                SELECT p.data
                FROM part p
                WHERE p.session_id = ?
                ORDER BY p.time_created ASC
            """, (s_id,))
            
            parts_data = cursor.fetchall()
            user_prompts = []
            assistant_snippets = []

            for row in parts_data:
                try:
                    data = json.loads(row["data"])
                    part_type = data.get("type")
                    if part_type == "text" and "text" in data:
                        txt = data["text"].strip()
                        if txt:
                            if len(user_prompts) == len(assistant_snippets):
                                user_prompts.append(txt)
                            else:
                                assistant_snippets.append(txt)
                except Exception:
                    continue

            dt = datetime.fromtimestamp(s["time_created"] / 1000).strftime("%Y-%m-%d %H:%M")
            mode = (s["agent"] or "build").upper()
            queries = [q.replace("\n", " ")[:120] for q in user_prompts[:3]]

            results.append({
                "id": s_id,
                "title": s["title"] or "Session",
                "date": dt,
                "mode": mode,
                "queries": queries,
            })

        conn.close()
        return results
    except Exception as e:
        print(f"[sync_ledger] Warning: unable to query opencode.db: {e}", file=sys.stderr)
        return []

def generate_learning_path_md(project_root: Path, session_logs: list):
    output_path = project_root / "LEARNING_PATH.md"

    lines = [
        "# Project Learning Path & Knowledge Ledger",
        "",
        "> Auto-synced across OpenCode sessions. Captures architectural milestones, design trade-offs, and interview talking points.",
        "",
        "## Active Project Context",
        f"- **Repository Path**: `{project_root}`",
        f"- **Last Updated**: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- **Total Recorded Sessions**: {len(session_logs)}",
        "",
        "## Session History & Architectural Log",
        ""
    ]

    if not session_logs:
        lines.append("No recorded sessions yet in this project directory.")
    else:
        max_sessions = 8
        visible_sessions = session_logs[-max_sessions:] if len(session_logs) > max_sessions else session_logs
        if len(session_logs) > max_sessions:
            lines.append(f"*({len(session_logs) - max_sessions} earlier session(s) archived to maintain optimal context window)*\n")

        for s in visible_sessions:
            lines.append(f"### [{s['mode']}] {s['title']} ({s['date']})")
            if s["queries"]:
                lines.append("**Key Inquiries & Themes:**")
                for q in s["queries"]:
                    lines.append(f"- {q}")
            lines.append("")

    existing_custom = ""
    if output_path.exists():
        try:
            content = output_path.read_text(encoding="utf-8")
            if "## Custom Notes & Interview Rationale" in content:
                existing_custom = content.split("## Custom Notes & Interview Rationale", 1)[1]
        except Exception:
            pass

    lines.append("## Custom Notes & Interview Rationale")
    if existing_custom:
        lines.append(existing_custom.strip())
    else:
        lines.append("- *(Notes, interview talking points, or architectural ideas kept here persist across syncs)*")
    lines.append("")

    try:
        output_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"[sync_ledger] Updated: {output_path}")
    except Exception as e:
        print(f"[sync_ledger] Warning: could not write {output_path}: {e}", file=sys.stderr)

def main():
    target_dir = os.getcwd()
    if len(sys.argv) > 1 and sys.argv[1] == "--dir" and len(sys.argv) > 2:
        target_dir = sys.argv[2]
    
    project_root = find_project_root(target_dir)
    sessions = fetch_sessions_and_messages(str(project_root))
    generate_learning_path_md(project_root, sessions)

if __name__ == "__main__":
    main()
