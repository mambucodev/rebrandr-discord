import {
  ChannelType,
  Client,
  ForumChannel,
  Guild,
  ThreadChannel,
} from "discord.js";
import { database, RebrandDatabase } from "../database";
import { syncThreadProposal } from "../handlers/threadHandler";
import {
  createProposalEmbed,
  createProposalActionRow,
  toContainerPayload,
  getContainerText,
} from "./announcement";

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
   * Deletes any wrong bot proposal cards or pin notifications in a thread
   * that does NOT qualify as a rebrand proposal.
   */
  public async cleanupWrongBotMessagesInThread(thread: ThreadChannel): Promise<number> {
    const botId = thread.client?.user?.id;
    if (!botId || !thread.messages?.fetch) return 0;
    let deletedCount = 0;
    try {
      const messages = await thread.messages.fetch({ limit: 25 }).catch(() => null);
      if (!messages) return 0;
      for (const [, m] of messages) {
        const isBotProposalCard =
          m.author?.id === botId &&
          ((m.embeds?.some((e: any) => e.title?.includes("Proposal #") || e.title?.includes("Pending Rebrand")) || false) ||
           getContainerText(m).includes("Proposal #") ||
           getContainerText(m).includes("Pending Rebrand"));
        const isPinNotification = m.type === 24 && m.deletable;

        if (isBotProposalCard && typeof m.delete === "function") {
          console.log(
            `[Recovery] Deleting wrong bot proposal card message ${m.id} in non-rebrand thread "${thread.name}" (${thread.id})`
          );
          await m.delete().catch(() => null);
          deletedCount++;
        } else if (isPinNotification && typeof m.delete === "function") {
          await m.delete().catch(() => null);
          deletedCount++;
        }
      }
    } catch (err) {
      console.warn(`[Recovery] Could not clean messages in thread ${thread.id}:`, err);
    }
    return deletedCount;
  }

  /**
   * Retroactively synchronizes a guild after downtime:
   * - Scans forum channel for active & recent archived threads with the rebrand tag.
   * - Scans pending proposals in the database to sync reaction counts or clean deleted threads.
   * - Retroactively cleans up and deletes wrong proposal cards posted into non-rebrand threads.
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
        const archivedResult = await forum.threads.fetchArchived({ limit: 50 }).catch(() => null);

        const allForumThreads: ThreadChannel[] = [];
        if (activeResult?.threads) {
          for (const [, thread] of activeResult.threads) {
            allForumThreads.push(thread);
          }
        }
        if (archivedResult?.threads) {
          for (const [, thread] of archivedResult.threads) {
            if (!activeResult?.threads.has(thread.id)) {
              allForumThreads.push(thread);
            }
          }
        }

        const threadsToProcess: ThreadChannel[] = [];

        for (const thread of allForumThreads) {
          const hasRebrandTag = Boolean(
            settings.rebrand_tag_id && thread.appliedTags?.includes(settings.rebrand_tag_id)
          );
          const existingProposal = db.getProposalByThreadId(thread.id);

          if (hasRebrandTag) {
            // Legitimate active rebrand proposal
            threadsToProcess.push(thread);
          } else if (existingProposal) {
            // Does not have rebrand tag, but proposal exists in DB
            const isApproved =
              (existingProposal.status === "approved" ||
                existingProposal.status === "active" ||
                existingProposal.status === "completed") &&
              Boolean(settings.approved_tag_id && thread.appliedTags?.includes(settings.approved_tag_id));

            const isDeclined =
              existingProposal.status === "rejected" &&
              Boolean(settings.declined_tag_id && thread.appliedTags?.includes(settings.declined_tag_id));

            if (isApproved || isDeclined) {
              // Legitimate resolved rebrand proposal whose tag transitioned to approved/declined
              threadsToProcess.push(thread);
            } else {
              // Pending proposal without rebrand tag (e.g. erroneously created or tag stripped by mod)
              console.log(
                `[Recovery] Pending proposal #${existingProposal.id} in thread "${thread.name}" (${thread.id}) lacks rebrand tag. Cleaning up...`
              );
              db.cancelProposal(existingProposal.id);
              report.staleProposalsCleaned++;
              processedThreadIds.add(thread.id);

              if (existingProposal.message_id) {
                const cardMsg = await thread.messages.fetch(existingProposal.message_id).catch(() => null);
                if (cardMsg && typeof cardMsg.delete === "function") {
                  await cardMsg.delete().catch(() => null);
                }
              }
              await this.cleanupWrongBotMessagesInThread(thread);
            }
          } else {
            // Non-rebrand thread and not tracked in DB: ensure no accidental proposal cards exist
            await this.cleanupWrongBotMessagesInThread(thread);
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

      // Check if rebrand tag was removed by a moderator while offline
      const hasRebrand = Boolean(settings.rebrand_tag_id && thread.appliedTags?.includes(settings.rebrand_tag_id));

      if (!hasRebrand) {
        console.log(`[Recovery] Rebrand tag was removed by moderator or absent on thread ${thread.id}. Cancelling proposal #${proposal.id}...`);
        db.cancelProposal(proposal.id);
        report.staleProposalsCleaned++;
        if (proposal.message_id) {
          const cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
          if (cardMsg && typeof cardMsg.delete === "function") {
            await cardMsg.delete().catch(() => null);
          }
        }
        await this.cleanupWrongBotMessagesInThread(thread);
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

    // 3. Retroactively update all remaining proposals across this guild to the new embed styling
    const allProposals = db.getAllProposals ? db.getAllProposals(guild.id) : [];
    for (const proposal of allProposals) {
      if (!proposal.thread_id || processedThreadIds.has(proposal.thread_id)) {
        continue;
      }
      if (proposal.status === "cancelled") {
        continue;
      }

      try {
        const thread = (await guild.channels.fetch(proposal.thread_id).catch(() => null)) as ThreadChannel | null;
        if (!thread) continue;

        const hasRebrand = Boolean(settings.rebrand_tag_id && thread.appliedTags?.includes(settings.rebrand_tag_id));
        const isApproved =
          (proposal.status === "approved" || proposal.status === "active" || proposal.status === "completed") &&
          Boolean(settings.approved_tag_id && thread.appliedTags?.includes(settings.approved_tag_id));
        const isDeclined =
          proposal.status === "rejected" &&
          Boolean(settings.declined_tag_id && thread.appliedTags?.includes(settings.declined_tag_id));

        if (!hasRebrand && !isApproved && !isDeclined) {
          continue;
        }

        processedThreadIds.add(thread.id);

        if (proposal.message_id) {
          const cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
          if (cardMsg && typeof cardMsg.edit === "function") {
            const embed = createProposalEmbed(proposal, settings.min_upvotes);
            const row = createProposalActionRow(proposal, settings.min_upvotes);
            await cardMsg.edit(toContainerPayload(embed, [row])).catch(() => null);
            console.log(`[Recovery] Retroactively updated card message for proposal #${proposal.id} in thread ${thread.id}`);
          }
        }
      } catch (err) {
        console.error(`[Recovery] Error updating proposal #${proposal.id} card:`, err);
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
