import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { RebrandDatabase } from "../src/database";
import fs from "fs";
import path from "path";

/**
 * Creates a database using the pre-migration schema (`icon_url TEXT NOT NULL`)
 * plus the child `votes` and `suggestions` tables, so we can verify that the
 * in-place migration preserves child rows instead of cascade-deleting them.
 */
function createLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Pending Rebrand',
      topic TEXT,
      icon_url TEXT NOT NULL,
      icon_path TEXT,
      message_id TEXT,
      channel_id TEXT,
      thread_id TEXT,
      log_message_id TEXT,
      is_ready INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_date TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT,
      rejected_at TEXT,
      rejected_reason TEXT
    );
  `);

  db.run(`
    CREATE TABLE votes (
      proposal_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      vote_type TEXT NOT NULL DEFAULT 'up',
      created_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, user_id),
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon_url TEXT NOT NULL,
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    INSERT INTO proposals (guild_id, user_id, name, icon_url, status, created_at)
    VALUES ('guild-1', 'user-1', 'Retro Weekend', 'https://example.com/legacy.png', 'pending', '2026-01-01T00:00:00.000Z');
  `);

  db.run(`
    INSERT INTO votes (proposal_id, user_id, vote_type, created_at) VALUES
      (1, 'user-2', 'up', '2026-01-01T00:00:00.000Z'),
      (1, 'user-3', 'down', '2026-01-01T00:00:00.000Z');
  `);

  db.run(`
    INSERT INTO suggestions (proposal_id, user_id, name, icon_url, status, created_at)
    VALUES (1, 'user-4', 'Synthwave Alt', 'https://example.com/alt.png', 'pending', '2026-01-01T00:00:00.000Z');
  `);

  db.close();
}

describe("RebrandDatabase legacy schema migration", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_migration.sqlite");

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    createLegacyDatabase(testDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it("preserves votes and suggestions when making icon_url nullable", () => {
    // Constructing RebrandDatabase runs initSchema, which triggers the migration.
    const rebrandDb = new RebrandDatabase(testDbPath);

    // The existing proposal should survive with id intact.
    const proposal = rebrandDb.getProposal(1);
    expect(proposal?.name).toBe("Retro Weekend");
    expect(proposal?.upvotes_count).toBe(1);
    expect(proposal?.downvotes_count).toBe(1);

    rebrandDb.close();

    // Verify child rows are untouched via a fresh connection.
    const raw = new Database(testDbPath, { readonly: true });
    const votes = raw.query("SELECT COUNT(*) AS c FROM votes").get() as { c: number };
    const suggestions = raw.query("SELECT COUNT(*) AS c FROM suggestions").get() as { c: number };
    expect(votes.c).toBe(2);
    expect(suggestions.c).toBe(1);

    // The whole point of the migration: icon_url must now be nullable.
    const columns = raw.query("PRAGMA table_info(proposals);").all() as Array<{ name: string; notnull: number }>;
    const iconUrlColumn = columns.find((c) => c.name === "icon_url");
    expect(iconUrlColumn?.notnull).toBe(0);

    raw.close();
  });

  it("allows a proposal to be inserted with a null icon_url after migration", () => {
    const rebrandDb = new RebrandDatabase(testDbPath);
    const proposal = rebrandDb.createProposal({
      guildId: "guild-1",
      userId: "user-5",
      threadId: "thread-new",
    });
    expect(proposal.icon_url).toBeNull();
    expect(proposal.is_ready).toBe(0);
    rebrandDb.close();
  });
  it("auto-seeds from seed/rebrand.sqlite when database has 0 proposals", () => {
    const seedTestDbPath = path.resolve(process.cwd(), "data", "test-autoseed.sqlite");
    if (fs.existsSync(seedTestDbPath)) fs.unlinkSync(seedTestDbPath);
    const freshDb = new RebrandDatabase(seedTestDbPath);
    expect(freshDb.getAllProposals("1300606629083086878").length).toBe(0);

    freshDb.autoSeedIfEmpty(true);
    const proposals = freshDb.getAllProposals("1300606629083086878");
    expect(proposals.length).toBeGreaterThan(0);
    const settings = freshDb.getGuildSettings("1300606629083086878");
    expect(settings.forum_channel_id).toBe("1341773745647255683");
    freshDb.close();
    if (fs.existsSync(seedTestDbPath)) fs.unlinkSync(seedTestDbPath);
  });
});
