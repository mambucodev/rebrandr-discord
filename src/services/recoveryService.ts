import {
  ChannelType,
  Client,
  ForumChannel,
  Guild,
  ThreadChannel,
} from "discord.js";
import { database, RebrandDatabase } from "../database";
import { syncThreadProposal } from "../handlers/threadHandler";

export interface RecoverySyncReport {
  threadsProcessed: number;
  proposalsCreated: number;
  cardsPinned: number;
  votesRecounted: number;
  adminLogsNotified: number;
  staleProposalsCleaned: number;
}

export class RecoveryService {
  /**
   * Retroactively synchronizes a guild after downtime:
   * - Scans forum channel for active & recent archived threads with the rebrand tag.
   * - Scans pending proposals in the database to sync reaction counts or clean deleted threads.
   */
  public async syncGuild(guild: Guild, db: RebrandDatabase = database): Promise<RecoverySyncReport> {
    console.log(`[Recovery] Starting retroactive sync for guild "${guild.name}" (${guild.id})...`);
    const report: RecoverySyncReport = {
      threadsProcessed: 0,
      proposalsCreated: 0,
      cardsPinned: 0,
      votesRecounted: 0,
      adminLogsNotified: 0,
      staleProposalsCleaned: 0,
    };

    const settings = db.getGuildSettings(guild.id);
    const processedThreadIds = new Set<string>();

    // 1. Scan forum channel threads if configured
    if (settings.forum_channel_id && settings.rebrand_tag_id) {
      console.log(`[Recovery] Checking forum channel ${settings.forum_channel_id} with tag ${settings.rebrand_tag_id}...`);
      const forumChannel = await guild.channels.fetch(settings.forum_channel_id).catch(() => null);
      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        const forum = forumChannel as ForumChannel;

        const activeResult = await forum.threads.fetchActive().catch(() => null);
        const threadsToProcess: ThreadChannel[] = [];

        if (activeResult?.threads) {
          for (const [, thread] of activeResult.threads) {
            if (thread.appliedTags.includes(settings.rebrand_tag_id)) {
              threadsToProcess.push(thread);
            }
          }
        }

        const archivedResult = await forum.threads.fetchArchived({ limit: 50 }).catch(() => null);
        if (archivedResult?.threads) {
          for (const [, thread] of archivedResult.threads) {
            if (
              thread.appliedTags.includes(settings.rebrand_tag_id) &&
              !activeResult?.threads.has(thread.id)
            ) {
              threadsToProcess.push(thread);
            }
          }
        }

        console.log(`[Recovery] Found ${threadsToProcess.length} tagged forum thread(s) to process.`);
        for (const thread of threadsToProcess) {
          processedThreadIds.add(thread.id);
          report.threadsProcessed++;
          try {
            const res = await syncThreadProposal(thread, settings, db);
            if (res.created) report.proposalsCreated++;
            if (res.pinned) report.cardsPinned++;
            report.votesRecounted++;
            if (res.notified) report.adminLogsNotified++;
          } catch (err) {
            console.error(`[Recovery] Error syncing thread ${thread.id}:`, err);
          }
        }
      }
    } else {
      console.log(`[Recovery] Guild "${guild.name}" does not have forum channel or rebrand tag configured.`);
    }

    // 2. Scan pending proposals in the database that might not be in the forum listing
    const pending = db.getProposalsByStatus(guild.id, "pending");
    for (const proposal of pending) {
      if (!proposal.thread_id || processedThreadIds.has(proposal.thread_id)) {
        continue;
      }

      const thread = (await guild.channels.fetch(proposal.thread_id).catch(() => null)) as ThreadChannel | null;
      if (!thread) {
        // Thread was deleted while the bot was offline
        console.log(`[Recovery] Thread ${proposal.thread_id} for proposal #${proposal.id} was deleted. Cancelling...`);
        db.cancelProposal(proposal.id);
        report.staleProposalsCleaned++;
        continue;
      }

      processedThreadIds.add(thread.id);
      report.threadsProcessed++;
      try {
        const res = await syncThreadProposal(thread, settings, db);
        if (res.pinned) report.cardsPinned++;
        report.votesRecounted++;
        if (res.notified) report.adminLogsNotified++;
      } catch (err) {
        console.error(`[Recovery] Error syncing pending thread ${thread.id}:`, err);
      }
    }

    console.log(
      `[Recovery] Guild "${guild.name}" sync complete: ${report.threadsProcessed} threads checked, ${report.proposalsCreated} proposals created, ${report.cardsPinned} cards pinned, ${report.votesRecounted} vote tallies refreshed, ${report.adminLogsNotified} notified to logs, ${report.staleProposalsCleaned} stale cleaned.`
    );
    return report;
  }

  /**
   * Retroactively syncs all guilds the bot belongs to when reconnecting.
   */
  public async syncAllGuilds(
    client: Client,
    db: RebrandDatabase = database
  ): Promise<Record<string, RecoverySyncReport>> {
    console.log(`[Recovery] Synchronizing all ${client.guilds.cache.size} connected guild(s)...`);
    const results: Record<string, RecoverySyncReport> = {};

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        results[guildId] = await this.syncGuild(guild, db);
      } catch (err) {
        console.error(`[Recovery] Failed to sync guild ${guild.name} (${guildId}):`, err);
      }
    }

    return results;
  }
}

export const recoveryService = new RecoveryService();
