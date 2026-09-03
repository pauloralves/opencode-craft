# AGENTS.md — opencode-craft

OpenCode plugin: senior pair-programmer agent (`craft`), skills (`@expand`, `@interview-angle`), and auto-synced knowledge ledger (`LEARNING_PATH.md`).

## Commands

- `npm test` — runs `node --test tests/*.test.js` (5 test files, no framework). No lint/typecheck scripts exist; tests are the only verification.
- `npm run release <patch|minor|major>` — bumps `package.json` version via `npm version`. Releases trigger `npm-publish.yml` (publishes to npm on GitHub release event, Node 24, OIDC trusted publishing — no token needed).
- `npx opencode-craft eject` — scaffolds `.opencode/agents/craft.md` and `.opencode/skills/…` into the current project for local override.
- `npx opencode-craft sync` — manually triggers ledger sync (normally automatic on `session.created` / `session.idle`).

## Architecture

- **Entry point**: `src/index.js` exports only `CraftPlugin` (named + default) — no other top-level function exports, since opencode invokes every exported function as a separate plugin. `syncLedger` lives in `src/ledger.js` (imported by `bin/opencode-craft.mjs`). Zero runtime dependencies; pure Node ESM (`"type": "module"`).
- **Plugin hook**: `config(cfg)` auto-registers the `craft` agent (from `agents/craft.md`) and adds `skills/` paths unless already defined by user config. `event()` triggers ledger sync on session start/idle.
- **Ledger**: `scripts/sync_ledger.py` reads OpenCode session history from `~/.local/share/opencode/opencode.db` (SQLite, read-only) and writes `LEARNING_PATH.md` in the project root. Falls back to SQLite CLI for older Node; Python is last resort.
- **Graduated density** (in `sync_ledger.py`): last 8 sessions keep full query detail, next 12 collapse to title-only, older sessions compress to a single aggregate date-range line.
- **Skills**: `skills/expand/SKILL.md`, `skills/interview-angle/SKILL.md` — auto-discovered and registered via `cfg.skills.paths`.

## Repo Quirks

- `LEARNING_PATH.md` and `.opencode/` are gitignored — ledger output and ejected files never commit.
- `AGENTS.md`, `.git`, `.opencode/`, or `package.json` presence is used by `sync_ledger.py:find_project_root` to locate the project root for ledger writes. Adding `AGENTS.md` here is safe and helps detection.
- `agents/craft.md` uses YAML frontmatter (`---` delimited); `src/index.js` strips it before injecting the prompt into the agent config.
- `craft.md` prompt is intentionally under ~500 tokens (~1,750 chars) to keep the system message lightweight.
- Tests use `node:test` only — no external test framework. `tests/cli.test.js` shells out to `bin/opencode-craft.mjs` via `execFileSync`; it creates temp dirs and cleans them up.
- CI installs `sqlite3` and `python3` on the runner before `npm test` (required by ledger tests on some Node versions).