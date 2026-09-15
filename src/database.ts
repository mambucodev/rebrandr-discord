import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { getCurrentOrNextWeekendSaturday, getNextSaturdayAfter } from "./utils/dateUtils";

export interface GuildSettings {
  guild_id: string;
  logs_channel_id: string | null;
  forum_channel_id: string | null;
  rebrand_tag_id: string | null;
  approved_tag_id: string | null;
  declined_tag_id: string | null;
  min_upvotes: number;
  custom_upvote_emojis: string | null;
  custom_downvote_emojis: string | null;
  default_name: string | null;
  default_icon_url: string | null;
  default_icon_path: string | null;
  active_proposal_id: number | null;
  created_at: string;
  updated_at: string;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "active" | "completed" | "cancelled";
export type VoteType = "up" | "down";

export interface Proposal {
  id: number;
  guild_id: string;
  user_id: string;
  name: string;
  topic: string | null;
  icon_url: string | null;
  icon_path: string | null;
  message_id: string | null;
  channel_id: string | null;
  thread_id: string | null;
  log_message_id: string | null;
  is_ready: number;
  status: ProposalStatus;
  scheduled_date: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
}

export interface ProposalWithVotes extends Proposal {
  upvotes_count: number;
  downvotes_count: number;
  net_votes: number;
  vote_count: number;
  upvotes: number;
  downvotes: number;
  netVotes: number;
  voteCount: number;
}

export interface Suggestion {
  id: number;
  proposal_id: number;
  user_id: string;
  name: string;
  icon_url: string;
  topic: string | null;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

export class RebrandDatabase {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string = config.dbPath) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.initSchema();
    this.normalizeIconPaths();
  }

  private initSchema(): void {
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA foreign_keys = ON;");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        logs_channel_id TEXT,
        forum_channel_id TEXT,
        rebrand_tag_id TEXT,
        approved_tag_id TEXT,
        declined_tag_id TEXT,
        min_upvotes INTEGER DEFAULT 4,
        custom_upvote_emojis TEXT,
        custom_downvote_emojis TEXT,
        default_name TEXT,
        default_icon_url TEXT,
        default_icon_path TEXT,
        active_proposal_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Pending Rebrand',
        topic TEXT,
        icon_url TEXT,
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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS votes (
        proposal_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        vote_type TEXT NOT NULL DEFAULT 'up',
        created_at TEXT NOT NULL,
        PRIMARY KEY (proposal_id, user_id),
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS suggestions (
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

    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN logs_channel_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN forum_channel_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN rebrand_tag_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN approved_tag_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN declined_tag_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN custom_upvote_emojis TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE guild_settings ADD COLUMN custom_downvote_emojis TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE proposals ADD COLUMN thread_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE proposals ADD COLUMN log_message_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE proposals ADD COLUMN is_ready INTEGER DEFAULT 0;");
    } catch {}

    this.migrateProposalsIconUrlNullable();

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_proposals_guild_status ON proposals(guild_id, status);
      CREATE INDEX IF NOT EXISTS idx_proposals_scheduled_date ON proposals(guild_id, scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_proposals_thread_id ON proposals(thread_id);
    `);
  }

  private migrateProposalsIconUrlNullable(): void {
    const columns = this.db.query("PRAGMA table_info(proposals);").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const iconUrlColumn = columns.find((c) => c.name === "icon_url");
    if (!iconUrlColumn || iconUrlColumn.notnull === 0) {
      return;
    }

    this.db.run("PRAGMA foreign_keys = OFF;");
    try {
      this.db.transaction(() => {
        this.db.run(`
          CREATE TABLE proposals_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Pending Rebrand',
            topic TEXT,
            icon_url TEXT,
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
        this.db.run(`
          INSERT INTO proposals_new (
            id, guild_id, user_id, name, topic, icon_url, icon_path,
            message_id, channel_id, thread_id, log_message_id, is_ready,
            status, scheduled_date, created_at, approved_at, approved_by,
            rejected_at, rejected_reason
          )
          SELECT
            id, guild_id, user_id, name, topic, icon_url, icon_path,
            message_id, channel_id, thread_id, log_message_id, is_ready,
            status, scheduled_date, created_at, approved_at, approved_by,
            rejected_at, rejected_reason
          FROM proposals;
        `);
        this.db.run("DROP TABLE proposals;");
        this.db.run("ALTER TABLE proposals_new RENAME TO proposals;");

        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_proposals_guild_status ON proposals(guild_id, status);
          CREATE INDEX IF NOT EXISTS idx_proposals_scheduled_date ON proposals(guild_id, scheduled_date);
          CREATE INDEX IF NOT EXISTS idx_proposals_thread_id ON proposals(thread_id);
        `);
      })();
    } finally {
      this.db.run("PRAGMA foreign_keys = ON;");
    }
  }

  public getGuildSettings(guildId: string): GuildSettings {
    const row = this.db.query("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as GuildSettings | null;
    if (row) {
      return row;
    }

    const now = new Date().toISOString();
    const defaultSettings: GuildSettings = {
      guild_id: guildId,
      logs_channel_id: null,
      forum_channel_id: null,
      rebrand_tag_id: null,
      approved_tag_id: null,
      declined_tag_id: null,
      min_upvotes: config.defaultMinUpvotes,
      custom_upvote_emojis: null,
      custom_downvote_emojis: null,
      default_name: null,
      default_icon_url: null,
      default_icon_path: null,
      active_proposal_id: null,
      created_at: now,
      updated_at: now,
    };

    this.db.run(
      `INSERT INTO guild_settings (guild_id, logs_channel_id, forum_channel_id, rebrand_tag_id, approved_tag_id, declined_tag_id, min_upvotes, custom_upvote_emojis, custom_downvote_emojis, default_name, default_icon_url, default_icon_path, active_proposal_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        defaultSettings.guild_id,
        defaultSettings.logs_channel_id,
        defaultSettings.forum_channel_id,
        defaultSettings.rebrand_tag_id,
        defaultSettings.approved_tag_id,
        defaultSettings.declined_tag_id,
        defaultSettings.min_upvotes,
        defaultSettings.custom_upvote_emojis,
        defaultSettings.custom_downvote_emojis,
        defaultSettings.default_name,
        defaultSettings.default_icon_url,
        defaultSettings.default_icon_path,
        defaultSettings.active_proposal_id,
        defaultSettings.created_at,
        defaultSettings.updated_at,
      ]
    );

    return defaultSettings;
  }

  public updateGuildSettings(guildId: string, updates: Partial<GuildSettings>): GuildSettings {
    const current = this.getGuildSettings(guildId);
    const updated: GuildSettings = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    this.db.run(
      `UPDATE guild_settings
       SET logs_channel_id = ?,
           forum_channel_id = ?,
           rebrand_tag_id = ?,
           approved_tag_id = ?,
           declined_tag_id = ?,
           min_upvotes = ?,
           custom_upvote_emojis = ?,
           custom_downvote_emojis = ?,
           default_name = ?,
           default_icon_url = ?,
           default_icon_path = ?,
           active_proposal_id = ?,
           updated_at = ?
       WHERE guild_id = ?`,
      [
        updated.logs_channel_id,
        updated.forum_channel_id,
        updated.rebrand_tag_id,
        updated.approved_tag_id,
        updated.declined_tag_id,
        updated.min_upvotes,
        updated.custom_upvote_emojis,
        updated.custom_downvote_emojis,
        updated.default_name,
        updated.default_icon_url,
        updated.default_icon_path,
        updated.active_proposal_id,
        updated.updated_at,
        guildId,
      ]
    );

    return updated;
  }

  public createProposal(data: {
    guildId: string;
    userId: string;
    name?: string;
    topic?: string | null;
    iconUrl?: string | null;
    iconPath?: string | null;
    threadId?: string | null;
    isReady?: number;
  }): Proposal {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO proposals (guild_id, user_id, name, topic, icon_url, icon_path, thread_id, is_ready, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      RETURNING *
    `);
    const proposal = query.get(
      data.guildId,
      data.userId,
      data.name ?? "Pending Rebrand",
      data.topic ?? null,
      data.iconUrl ?? null,
      data.iconPath ?? null,
      data.threadId ?? null,
      data.isReady ?? (data.iconUrl && data.name ? 1 : 0),
      now
    ) as Proposal;

    return proposal;
  }

  public getOrCreateProposalForThread(guildId: string, threadId: string, userId: string): ProposalWithVotes {
    const existing = this.getProposalByThreadId(threadId);
    if (existing) {
      return existing;
    }

    const proposal = this.createProposal({
      guildId,
      userId,
      threadId,
      name: "Pending Rebrand",
      iconUrl: null,
      isReady: 0,
    });

    return this.getProposal(proposal.id)!;
  }

  public updateProposalDetails(
    id: number,
    data: {
      name?: string;
      topic?: string | null;
      icon_url?: string | null;
      icon_path?: string | null;
      is_ready?: number;
    }
  ): ProposalWithVotes | null {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.topic !== undefined) {
      fields.push("topic = ?");
      values.push(data.topic);
    }
    if (data.icon_url !== undefined) {
      fields.push("icon_url = ?");
      values.push(data.icon_url);
    }
    if (data.icon_path !== undefined) {
      fields.push("icon_path = ?");
      values.push(data.icon_path);
    }
    if (data.is_ready !== undefined) {
      fields.push("is_ready = ?");
      values.push(data.is_ready);
    } else if (data.icon_url !== undefined) {
      fields.push("is_ready = ?");
      values.push(data.icon_url ? 1 : 0);
    }

    if (fields.length === 0) return this.getProposal(id);

    values.push(id);
    this.db.run(`UPDATE proposals SET ${fields.join(", ")} WHERE id = ?`, values);
    return this.getProposal(id);
  }

  public updateProposalMessage(id: number, messageId: string, channelId: string, threadId?: string): void {
    if (threadId) {
      this.db.run(
        "UPDATE proposals SET message_id = ?, channel_id = ?, thread_id = ? WHERE id = ?",
        [messageId, channelId, threadId, id]
      );
    } else {
      this.db.run(
        "UPDATE proposals SET message_id = ?, channel_id = ? WHERE id = ?",
        [messageId, channelId, id]
      );
    }
  }

  public updateProposalLogMessage(id: number, logMessageId: string): void {
    this.db.run(
      "UPDATE proposals SET log_message_id = ? WHERE id = ?",
      [logMessageId, id]
    );
  }

  public getProposal(id: number): ProposalWithVotes | null {
    const proposal = this.db.query("SELECT * FROM proposals WHERE id = ?").get(id) as Proposal | null;
    if (!proposal) return null;

    const voteCounts = this.getVoteCounts(id);
    return {
      ...proposal,
      ...voteCounts,
    };
  }

  public getProposalByThreadId(threadId: string): ProposalWithVotes | null {
    const proposal = this.db.query("SELECT * FROM proposals WHERE thread_id = ?").get(threadId) as Proposal | null;
    if (!proposal) return null;

    const voteCounts = this.getVoteCounts(proposal.id);
    return {
      ...proposal,
      ...voteCounts,
    };
  }

  public getVoteCounts(proposalId: number): {
    upvotes_count: number;
    downvotes_count: number;
    net_votes: number;
    vote_count: number;
    upvotes: number;
    downvotes: number;
    netVotes: number;
    voteCount: number;
  } {
    const upvotesRow = this.db.query(
      "SELECT COUNT(*) as count FROM votes WHERE proposal_id = ? AND vote_type = 'up'"
    ).get(proposalId) as { count: number };

    const downvotesRow = this.db.query(
      "SELECT COUNT(*) as count FROM votes WHERE proposal_id = ? AND vote_type = 'down'"
    ).get(proposalId) as { count: number };

    const upvotes = upvotesRow.count;
    const downvotes = downvotesRow.count;

    return {
      upvotes_count: upvotes,
      downvotes_count: downvotes,
      net_votes: upvotes - downvotes,
      vote_count: upvotes + downvotes,
      upvotes,
      downvotes,
      netVotes: upvotes - downvotes,
      voteCount: upvotes + downvotes,
    };
  }

  public setVotesForProposal(proposalId: number, upvoteUserIds: string[], downvoteUserIds: string[]): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.run("DELETE FROM votes WHERE proposal_id = ?", [proposalId]);

      const insertStmt = this.db.prepare(
        "INSERT INTO votes (proposal_id, user_id, vote_type, created_at) VALUES (?, ?, ?, ?)"
      );

      for (const uid of upvoteUserIds) {
        insertStmt.run(proposalId, uid, "up", now);
      }
      for (const uid of downvoteUserIds) {
        insertStmt.run(proposalId, uid, "down", now);
      }
    })();
  }

  public createSuggestion(data: {
    proposalId: number;
    userId: string;
    name: string;
    iconUrl: string;
    topic?: string | null;
  }): Suggestion {
    const now = new Date().toISOString();
    const query = this.db.query(`
      INSERT INTO suggestions (proposal_id, user_id, name, icon_url, topic, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
      RETURNING *
    `);
    return query.get(
      data.proposalId,
      data.userId,
      data.name,
      data.iconUrl,
      data.topic ?? null,
      now
    ) as Suggestion;
  }

  public getSuggestion(id: number): Suggestion | null {
    return this.db.query("SELECT * FROM suggestions WHERE id = ?").get(id) as Suggestion | null;
  }

  public getSuggestionsForProposal(proposalId: number): Suggestion[] {
    return this.db.query("SELECT * FROM suggestions WHERE proposal_id = ? ORDER BY id ASC").all(proposalId) as Suggestion[];
  }

  public updateSuggestionStatus(id: number, status: "accepted" | "rejected"): void {
    this.db.run("UPDATE suggestions SET status = ? WHERE id = ?", [status, id]);
  }

  public approveProposal(id: number, approvedBy: string): ProposalWithVotes | null {
    const proposal = this.getProposal(id);
    if (!proposal) return null;

    const nextSlot = this.calculateNextAvailableSlot(proposal.guild_id);
    const now = new Date().toISOString();

    this.db.run(
      `UPDATE proposals
       SET status = 'approved',
           scheduled_date = ?,
           approved_by = ?,
           approved_at = ?
       WHERE id = ?`,
      [nextSlot, approvedBy, now, id]
    );

    return this.getProposal(id);
  }

  public rejectProposal(id: number, reason: string | null = null): ProposalWithVotes | null {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE proposals
       SET status = 'rejected',
           rejected_reason = ?,
           rejected_at = ?
       WHERE id = ?`,
      [reason, now, id]
    );
    return this.getProposal(id);
  }

  public cancelProposal(id: number): ProposalWithVotes | null {
    this.db.run("UPDATE proposals SET status = 'cancelled' WHERE id = ?", [id]);
    return this.getProposal(id);
  }

  public getAllProposals(guildId: string): ProposalWithVotes[] {
    const rows = this.db.query(
      "SELECT * FROM proposals WHERE guild_id = ? ORDER BY id ASC"
    ).all(guildId) as Proposal[];

    return rows.map((p) => ({
      ...p,
      ...this.getVoteCounts(p.id),
    }));
  }

  public getProposalsByStatus(guildId: string, status: ProposalStatus): ProposalWithVotes[] {
    const rows = this.db.query(
      "SELECT * FROM proposals WHERE guild_id = ? AND status = ? ORDER BY id ASC"
    ).all(guildId, status) as Proposal[];

    return rows.map((p) => ({
      ...p,
      ...this.getVoteCounts(p.id),
    }));
  }

  public getUpcomingSchedule(guildId: string): ProposalWithVotes[] {
    const rows = this.db.query(
      `SELECT * FROM proposals
       WHERE guild_id = ? AND (status = 'approved' OR status = 'active')
       ORDER BY scheduled_date ASC, id ASC`
    ).all(guildId) as Proposal[];

    return rows.map((p) => ({
      ...p,
      ...this.getVoteCounts(p.id),
    }));
  }

  public getScheduledProposalForDate(guildId: string, dateIso: string): ProposalWithVotes | null {
    const row = this.db.query(
      `SELECT * FROM proposals
       WHERE guild_id = ? AND status = 'approved' AND scheduled_date = ?
       ORDER BY id ASC LIMIT 1`
    ).get(guildId, dateIso) as Proposal | null;

    if (!row) return null;
    return {
      ...row,
      ...this.getVoteCounts(row.id),
    };
  }

  public getNextApprovedProposalInQueue(guildId: string): ProposalWithVotes | null {
    const row = this.db.query(
      `SELECT * FROM proposals
       WHERE guild_id = ? AND status = 'approved'
       ORDER BY scheduled_date ASC, id ASC LIMIT 1`
    ).get(guildId) as Proposal | null;

    if (!row) return null;
    return {
      ...row,
      ...this.getVoteCounts(row.id),
    };
  }

  public calculateNextAvailableSlot(guildId: string): string {
    const scheduled = this.getUpcomingSchedule(guildId);
    let candidate = getCurrentOrNextWeekendSaturday();

    const scheduledDates = new Set(scheduled.map((p) => p.scheduled_date).filter(Boolean));

    while (scheduledDates.has(candidate)) {
      candidate = getNextSaturdayAfter(candidate);
    }

    return candidate;
  }

  public normalizeIconPaths(): void {
    try {
      const proposalsWithIcons = this.db.query("SELECT id, icon_path FROM proposals WHERE icon_path IS NOT NULL").all() as any[];
      for (const p of proposalsWithIcons) {
        const filename = path.basename(p.icon_path);
        const newPath = path.join(config.iconsDir, filename);
        if (p.icon_path !== newPath) {
          this.db.run("UPDATE proposals SET icon_path = ? WHERE id = ?", [newPath, p.id]);
        }
      }
      const settingsWithIcons = this.db.query("SELECT guild_id, default_icon_path FROM guild_settings WHERE default_icon_path IS NOT NULL").all() as any[];
      for (const s of settingsWithIcons) {
        const filename = path.basename(s.default_icon_path);
        const newPath = path.join(config.iconsDir, filename);
        if (s.default_icon_path !== newPath) {
          this.db.run("UPDATE guild_settings SET default_icon_path = ? WHERE guild_id = ?", [newPath, s.guild_id]);
        }
      }
    } catch (err) {
      // Ignored if tables do not exist yet during initial setup
    }
  }

  public close(): void {
    this.db.close();
  }
}

export let database = new RebrandDatabase();

export function setDatabase(newDb: RebrandDatabase): void {
  database = newDb;
}
