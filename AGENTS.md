# AI Coding Agent Guidelines & Project Rules

> **Cross-Agent Compatibility**: This configuration serves as the unified ruleset for **Antigravity (Google Gemini)**, **Claude Code**, **Cursor**, **GitHub Copilot**, **Aider**, and other AI coding assistants. Standalone links (`CLAUDE.md`, `GEMINI.md`) mirror this file to ensure zero instruction drift across agent environments.

---

## 1. Project Overview & Architecture

**Weekend Rebrand Bot** (`rebrand-bot`) is an automated Discord bot built with **Bun**, **TypeScript**, and **discord.js v14** for managing community-driven weekend server rebrands (UTC+0).

### Key Features & Workflow:
- **Proposals & Forum Threads**: Users submit proposals via `/propose` or tagged forum threads.
- **Reaction & Button Voting**: Community upvotes/downvotes proposals with deduplication, author restrictions, and customizable emojis.
- **Automated UTC Scheduling**:
  - **Saturday 00:00 UTC**: Applies approved rebrand (server name & icon) and posts announcement.
  - **Monday 00:00 UTC**: Reverts server to baseline defaults.
- **Offline Recovery**: Synchronizes threads, reactions, and schedules missed while offline.
- **Health Monitoring**: Lightweight HTTP `/health` server for Docker and Coolify deployments.

---

## 2. Runtime & Tech Stack Invariants

### ⚡ Runtime: Bun (Strict)
This project strictly runs on **Bun**. **NEVER** use Node.js or Node-specific package managers.
- Run files: `bun <file>` (never `node` or `ts-node`)
- Package management: `bun install`, `bun add <pkg>`, `bun remove <pkg>` (never `npm`, `yarn`, `pnpm`)
- Scripts: `bun run <script>` or `bun start`, `bun dev`
- CLI tools: `bunx <cmd>` (never `npx`)
- Test runner: `bun test` (never `jest`, `vitest`, `mocha`)
- Environment variables: Bun automatically loads `.env`. Do **not** use `dotenv`.

### 📦 Core Libraries & Built-ins
- **Discord Framework**: `discord.js` (v14)
- **Database**: `bun:sqlite` built-in SQLite driver. Do **not** install `better-sqlite3`, `sqlite3`, `prisma`, or `typeorm`.
- **File System**: Prefer `Bun.file()` for reading/writing files over `node:fs`.
- **HTTP Server**: Built-in `Bun.serve()` used in `src/services/healthServer.ts`. Do **not** install `express`, `fastify`, or `koa`.
- **Image Validation**: Magic-byte buffer validation (`src/utils/imageUtils.ts`) for server icons (PNG, JPEG, GIF, WebP).

---

## 3. Directory Layout & Module Responsibilities

```
rebrandr-discord/
├── index.ts                  # Bot entrypoint, Gateway client, event dispatchers, startup sync
├── src/
│   ├── commands/             # Slash command definitions & registrations
│   │   ├── index.ts          # Command registry & REST application command publishing
│   │   ├── propose.ts        # /propose command logic
│   │   ├── schedule.ts       # /schedule command
│   │   ├── proposals.ts      # /proposals (browse & list) commands
│   │   ├── upload.ts         # /upload command
│   │   ├── admin.ts          # /rebrand admin command tree (config, status, approve, revert, etc.)
│   │   ├── about.ts          # /about command (stats, commit, repo link)
│   │   └── help.ts           # /help command
│   ├── handlers/             # Discord event handlers
│   │   ├── interactionHandler.ts # Slash commands, buttons (upvote/approve/cancel), modals
│   │   └── threadHandler.ts      # Forum threads, tag detection, message auto-pin, reaction voting
│   ├── services/             # Core business & background services
│   │   ├── rebrandService.ts # Server name & icon switching, baseline management, bot branding
│   │   ├── scheduler.ts      # 30-second interval scheduler enforcing UTC weekend windows
│   │   ├── recoveryService.ts# Retroactive offline sync for threads, tags, and missed events
│   │   ├── announcement.ts   # Embed builders for scheduled, active, and completed rebrands
│   │   └── healthServer.ts   # Docker/Coolify HTTP healthcheck endpoint
│   ├── utils/                # Pure helper functions
│   │   ├── dateUtils.ts      # UTC+0 weekend boundary calculations & date formatting
│   │   ├── imageUtils.ts     # Image buffer validation & mime inspection
│   │   └── version.ts        # Git commit, version info, and repository link metadata
│   ├── config.ts             # Central configuration & path resolution
│   └── database.ts           # SQLite schema, migrations, and typed data queries
├── tests/                    # Bun test suites (run with `bun test`)
├── data/                     # Local SQLite database (rebrand.sqlite) & cached icons (icons/)
├── Dockerfile & docker-compose.yml # Containerized deployment configs
├── AGENTS.md                 # Universal AI agent rules (this file)
├── CLAUDE.md -> AGENTS.md    # Claude Code compatibility link
└── GEMINI.md -> AGENTS.md    # Antigravity/Gemini compatibility link
```

---

## 4. Development & Testing Commands

| Task | Command |
| :--- | :--- |
| **Install dependencies** | `bun install` |
| **Run bot (Production)** | `bun start` (`bun run index.ts`) |
| **Run bot (Watch mode)** | `bun dev` (`bun --watch index.ts`) |
| **Run all tests** | `bun test` |
| **Run single test file** | `bun test tests/<filename>.test.ts` |
| **Run specific test name** | `bun test -t "<test-pattern>"` |

---

## 5. Coding Standards & Architectural Rules

### Discord.js (v14) Patterns
1. **Interaction Acknowledgement**: Discord enforces a 3-second interaction response timeout.
   - For operations taking longer than 2 seconds (e.g. database transactions, external HTTP calls, image downloads), always call:
     - `await interaction.deferReply({ flags: MessageFlags.Ephemeral })` or `await interaction.deferUpdate()`
   - Follow up with `await interaction.editReply(...)`.
2. **Partial Handling**: The bot uses partials (`Partials.Message`, `Partials.Reaction`, `Partials.Channel`, `Partials.ThreadMember`). When handling reactions or messages, always check if `.partial` is true and call `await item.fetch()` if required.
3. **Forum Tag & Thread Invariants**:
   - Status tags (`approved`, `declined`) are exclusive; setting one replaces the other.
   - If a moderator untags a pending proposal thread without applying a status tag, mark the proposal as cancelled.
4. **Resilient Discord API Calls**:
   - Changing a guild's name or icon can be rate-limited by Discord or fail if permissions are missing. Always wrap Discord REST mutations in `try / catch` blocks and provide user-friendly feedback without crashing the process.

### Date & Time Constraints
- **Strict UTC+0**: All weekend calculations must be based on UTC.
  - Rebrand Start: Saturday 00:00:00 UTC.
  - Rebrand End: Sunday 23:59:59 UTC / Monday 00:00:00 UTC.
  - Never use local server time, machine timezone, or unanchored `new Date()` without UTC methods (`getUTCDay()`, `getUTCHours()`, etc.).

### SQLite (`bun:sqlite`) Database Rules
1. **Prepared Statements**: Use `db.prepare(...)` for all queries with parameters. Never interpolate unescaped variables into SQL strings.
2. **Migrations**: Schema changes in `src/database.ts` must be idempotent and non-destructive. Check existing columns (e.g. `PRAGMA table_info`) before applying `ALTER TABLE`.
3. **Storage Paths**: Always use paths from `src/config.ts` (`config.dbPath`, `config.iconsDir`). Never hardcode relative or absolute database file paths.

### Logging Conventions
Use prefixed, structured console logs for clarity:
- `[Bot]` - Startup, connection, and general bot lifecycle events.
- `[Commands]` - Slash command registration and dispatch.
- `[Reaction]` - Vote changes, emoji additions/removals.
- `[ThreadSync]` - Forum thread parsing, proposal card updates.
- `[Recovery]` - Retroactive offline synchronization.
- `[Scheduler]` - Periodic interval rebrand checks and triggers.

---

## 6. AI Agent Execution Protocol

When operating in this codebase, all AI agents must follow this workflow:
1. **Always Verify with Tests**: Run `bun test` after completing modifications to ensure no regressions across the test suite.
2. **Preserve Bun Conventions**: Never add dependencies from npm/node ecosystem when a Bun native API exists.
3. **Respect Established Patterns**: Look at existing handlers (`src/handlers/`) and services (`src/services/`) before inventing new architectural patterns.
4. **Avoid Stale Documentation**: Keep command tables in `README.md` and this rules file aligned when adding or changing commands.
