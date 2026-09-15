import {
  ThreadChannel,
  MessageReaction,
  User,
  Message,
  Collection,
} from "discord.js";
import { database, RebrandDatabase } from "../database";
import type { ProposalWithVotes, GuildSettings } from "../database";
import { rebrandService } from "../services/rebrandService";
import {
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
} from "../services/announcement";

const DEFAULT_UPVOTE_NAMES = new Set(["⬆️", "⬆", "👍", "🔺", "arrow_up", "+1"]);
const DEFAULT_DOWNVOTE_NAMES = new Set(["⬇️", "⬇", "👎", "🔻", "arrow_down", "-1"]);

/**
 * Splits comma- or space-separated emoji tokens and normalizes them:
 * - Custom Discord emoji tags: <:name:id> or <a:name:id> -> extracts both "name" and "id"
 * - Raw numeric IDs: 123456789012345678 -> "123456789012345678"
 * - Coloned names: :name: -> "name"
 * - Plain unicode: 🚀 -> "🚀"
 */
export function parseEmojiTokens(rawString: string | null | undefined): string[] {
  if (!rawString) return [];
  const tokens: string[] = [];
  const parts = rawString.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const customMatch = part.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
    if (customMatch && customMatch[1] && customMatch[2]) {
      tokens.push(customMatch[1]);
      tokens.push(customMatch[2]);
      continue;
    }

    const colonMatch = part.match(/^:([a-zA-Z0-9_]+):$/);
    if (colonMatch && colonMatch[1]) {
      tokens.push(colonMatch[1]);
      continue;
    }

    tokens.push(part);
  }

  return tokens;
}

export function matchesEmojiList(
  emoji: { name?: string | null; id?: string | null },
  customTokens: string[]
): boolean {
  if (customTokens.length === 0) return false;
  const id = emoji.id ?? "";
  const name = emoji.name ?? "";

  return customTokens.some((tok) => {
    if (id && tok === id) return true;
    if (name && (tok === name || `:${tok}:` === name)) return true;
    return false;
  });
}

export function isUpvoteEmoji(
  emoji: { name?: string | null; id?: string | null } | string,
  customUpvotesConfig?: string | null
): boolean {
  const emojiObj = typeof emoji === "string" ? { name: emoji } : emoji;
  if (emojiObj.name && DEFAULT_UPVOTE_NAMES.has(emojiObj.name)) {
    return true;
  }
  const customTokens = parseEmojiTokens(customUpvotesConfig);
  return matchesEmojiList(emojiObj, customTokens);
}

export function isDownvoteEmoji(
  emoji: { name?: string | null; id?: string | null } | string,
  customDownvotesConfig?: string | null
): boolean {
  const emojiObj = typeof emoji === "string" ? { name: emoji } : emoji;
  if (emojiObj.name && DEFAULT_DOWNVOTE_NAMES.has(emojiObj.name)) {
    return true;
  }
  const customTokens = parseEmojiTokens(customDownvotesConfig);
  return matchesEmojiList(emojiObj, customTokens);
}

/**
 * Strict verification: reactions should ONLY count if they are on the thread starter post itself.
 * Reactions on the bot's auto-sent card message or any other comments must be rejected.
 */
export function shouldCountReaction(
  reactionMessageId: string,
  starterMessageId: string | null | undefined,
  proposalCardMessageId: string | null | undefined
): boolean {
  if (proposalCardMessageId && reactionMessageId === proposalCardMessageId) {
    return false;
  }
  if (!starterMessageId || reactionMessageId !== starterMessageId) {
    return false;
  }
  return true;
}

/**
 * Iterates through all reactions on the thread post, filters out bots and thread authors,
 * and deduplicates users using a Set so reacting with multiple emojis only counts once per user.
 */
export async function collectVoteUserIds(
  reactionsCache: Collection<string, any> | Map<string, any>,
  authorUserIds: string | Set<string>,
  customUpvotesConfig?: string | null,
  customDownvotesConfig?: string | null
): Promise<{ upvotes: string[]; downvotes: string[] }> {
  const upvoteUserIds = new Set<string>();
  const downvoteUserIds = new Set<string>();

  const authorsSet =
    authorUserIds instanceof Set
      ? authorUserIds
      : new Set([authorUserIds]);

  for (const [, reaction] of reactionsCache) {
    const isUp = isUpvoteEmoji(reaction.emoji, customUpvotesConfig);
    const isDown = isDownvoteEmoji(reaction.emoji, customDownvotesConfig);

    if (!isUp && !isDown) {
      continue;
    }

    try {
      const users = await reaction.users.fetch();
      for (const [, user] of users) {
        if (user.bot) continue;
        if (authorsSet.has(user.id)) continue;

        if (isUp) {
          upvoteUserIds.add(user.id);
        } else if (isDown) {
          downvoteUserIds.add(user.id);
        }
      }
    } catch (err) {
      console.error("[Reaction] Error fetching users for reaction:", err);
    }
  }

  return {
    upvotes: Array.from(upvoteUserIds),
    downvotes: Array.from(downvoteUserIds).filter((uid) => !upvoteUserIds.has(uid)),
  };
}

export interface ThreadSyncResult {
  proposal: ProposalWithVotes;
  created: boolean;
  pinned: boolean;
  notified: boolean;
}

/**
 * Updates a proposal thread's forum status tag (approved, declined, or rebrand).
 * Enforces that only one status tag is assigned at a time:
 * Removes existing rebrand/approved/declined tags and applies the single new status tag.
 */
export async function updateThreadStatusTag(
  thread: ThreadChannel,
  status: "approved" | "declined" | "rebrand",
  settings: GuildSettings
): Promise<void> {
  if (!thread || typeof thread.setAppliedTags !== "function") return;

  const targetTagId =
    status === "approved"
      ? settings.approved_tag_id
      : status === "declined"
      ? settings.declined_tag_id
      : settings.rebrand_tag_id;

  if (!targetTagId) return;

  try {
    const statusTags = new Set(
      [settings.rebrand_tag_id, settings.approved_tag_id, settings.declined_tag_id].filter(Boolean)
    );
    const nonStatusTags = (thread.appliedTags || []).filter((id) => !statusTags.has(id));
    const newTags = [targetTagId, ...nonStatusTags].slice(0, 5);

    await thread.setAppliedTags(newTags);
    console.log(`[ThreadTags] Thread "${thread.name}" (${thread.id}) status tag updated to "${status}" (tag ID: ${targetTagId})`);
  } catch (err) {
    console.error(`[ThreadTags] Failed to update status tag on thread ${thread.id}:`, err);
  }
}

/**
 * Synchronizes a thread proposal (used on thread create, thread update, and startup recovery):
 * 1. Ensures the proposal record exists in the database.
 * 2. If starter post contains an attached image, downloads and validates it locally.
 * 3. Ensures the auto-sent proposal card exists and is pinned.
 * 4. Fetches reactions on the thread post to sync votes retroactively.
 * 5. Checks if upvote threshold is reached and sends admin logs prompt if needed.
 */
export async function syncThreadProposal(
  thread: ThreadChannel,
  settings: GuildSettings,
  db: RebrandDatabase = database
): Promise<ThreadSyncResult> {
  const guild = thread.guild;
  const ownerId = thread.ownerId || guild.ownerId;

  console.log(`[ThreadSync] Syncing thread "${thread.name}" (${thread.id}) in guild "${guild.name}"...`);

  let created = false;
  let pinned = false;
  let notified = false;

  let proposal = db.getProposalByThreadId(thread.id);
  if (!proposal) {
    proposal = db.getOrCreateProposalForThread(guild.id, thread.id, ownerId);
    created = true;
    console.log(`[ThreadSync] Created new proposal #${proposal.id} for thread ${thread.id} (Owner: ${ownerId})`);
  }

  // Fetch starter post directly from Discord to check for attachments and sync reactions
  let starterMessage: any = null;
  if (typeof thread.fetchStarterMessage === "function") {
    starterMessage = await thread.fetchStarterMessage().catch(() => null);
  }
  if (!starterMessage && thread.messages?.fetch) {
    starterMessage = await thread.messages.fetch(thread.id).catch(() => null);
  }

  // If starter post has an uploaded image attachment and proposal has no icon yet, automatically validate & adopt it
  if (starterMessage && (!proposal.icon_url || !proposal.icon_path)) {
    const attachments = starterMessage.attachments;
    let imgAttachment: any = null;
    if (attachments && typeof attachments.find === "function") {
      imgAttachment = attachments.find(
        (a: any) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.name || "")
      );
    }

    if (imgAttachment) {
      console.log(`[ThreadSync] Discovered uploaded image "${imgAttachment.name}" in starter post for thread ${thread.id}`);
      try {
        const cached = await rebrandService.downloadAndCacheImage(imgAttachment.url, `proposal_${guild.id}`);
        const cleanName = proposal.name === "Pending Rebrand" ? thread.name.replace(/^\[Rebrand\]\s*/i, "") : proposal.name;
        proposal = db.updateProposalDetails(proposal.id, {
          icon_url: imgAttachment.url,
          icon_path: cached.filePath,
          is_ready: 1,
          name: cleanName,
        })!;
      } catch (imgErr) {
        console.error("[ThreadSync] Failed to validate/cache starter message attachment:", imgErr);
      }
    }
  }

  let cardMsg: Message | null = null;
  if (proposal.message_id && thread.messages?.fetch) {
    cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
  }

  const embed = createProposalEmbed(proposal, settings.min_upvotes);
  const row = createProposalActionRow(proposal, settings.min_upvotes);

  if (!cardMsg && typeof thread.send === "function") {
    try {
      cardMsg = await thread.send({
        embeds: [embed],
        components: [row],
      });
      console.log(`[ThreadSync] Sent proposal card message ${cardMsg.id} in thread ${thread.id}`);

      if (typeof cardMsg?.pin === "function") {
        await cardMsg.pin().catch((err) => {
          console.error(`[ThreadSync] Failed to pin proposal card in thread ${thread.id}:`, err);
        });
        pinned = true;
        console.log(`[ThreadSync] Pinned proposal card message in thread ${thread.id}`);
      }

      // Clean up the automatic "pinned a message" system notification if permitted
      if (thread.messages?.fetch) {
        try {
          const recent = await thread.messages.fetch({ limit: 5 });
          if (Array.isArray(recent) || (recent && Symbol.iterator in Object(recent))) {
            const pinNotification = Array.from(recent as any).find((m: any) => m.type === 24 || (m as any).system);
            if (pinNotification?.deletable) {
              await pinNotification.delete().catch(() => null);
            }
          }
        } catch {}
      }

      if (cardMsg?.id) {
        db.updateProposalMessage(proposal.id, cardMsg.id, thread.id, thread.id);
      }
    } catch (err) {
      console.error(`[ThreadSync] Error posting proposal card in thread ${thread.id}:`, err);
    }
  } else if (cardMsg) {
    // Existing message: ensure it is pinned and updated
    if (typeof cardMsg.pin === "function" && !cardMsg.pinned) {
      await cardMsg.pin().catch(() => null);
      pinned = true;
      console.log(`[ThreadSync] Re-pinned existing proposal card ${cardMsg.id} in thread ${thread.id}`);
    }
    if (typeof cardMsg.edit === "function") {
      await cardMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
    }
  }

  if (starterMessage && starterMessage.reactions?.cache) {
    const authorIds = new Set<string>();
    if (proposal.user_id) authorIds.add(proposal.user_id);
    if (thread.ownerId) authorIds.add(thread.ownerId);
    if (starterMessage.author?.id) authorIds.add(starterMessage.author.id);

    const { upvotes, downvotes } = await collectVoteUserIds(
      starterMessage.reactions.cache,
      authorIds,
      settings.custom_upvote_emojis,
      settings.custom_downvote_emojis
    );

    db.setVotesForProposal(proposal.id, upvotes, downvotes);
    proposal = db.getProposal(proposal.id)!;
    console.log(
      `[ThreadSync] Proposal #${proposal.id} vote tally refreshed: ⬆️ ${proposal.upvotes_count} upvotes, ⬇️ ${proposal.downvotes_count} downvotes (Net: ${proposal.net_votes})`
    );

    if (cardMsg && typeof cardMsg.edit === "function") {
      const updatedEmbed = createProposalEmbed(proposal, settings.min_upvotes);
      const updatedRow = createProposalActionRow(proposal, settings.min_upvotes);
      await cardMsg.edit({ embeds: [updatedEmbed], components: [updatedRow] }).catch(() => null);
    }
  }

  // Check if upvote threshold is reached and notify admin logs
  if (proposal.status === "pending" && proposal.is_ready === 1 && proposal.upvotes_count >= settings.min_upvotes) {
    console.log(`[ThreadSync] Proposal #${proposal.id} reached upvote goal (${proposal.upvotes_count}/${settings.min_upvotes}). Notifying admin logs...`);
    await rebrandService.checkAndNotifyAdminLogs(guild, proposal.id);
    notified = true;
  }

  return {
    proposal,
    created,
    pinned,
    notified,
  };
}

export async function handleThreadCreate(thread: ThreadChannel, db: RebrandDatabase = database): Promise<void> {
  const guild = thread.guild;
  if (!guild) return;

  console.log(`[ThreadCreate] New thread detected: "${thread.name}" (${thread.id}) in guild "${guild.name}"`);

  const settings = db.getGuildSettings(guild.id);
  if (!settings.forum_channel_id || !settings.rebrand_tag_id) {
    return;
  }

  if (thread.parentId !== settings.forum_channel_id) {
    return;
  }

  const hasRebrandTag = thread.appliedTags.includes(settings.rebrand_tag_id);
  if (!hasRebrandTag) {
    console.log(`[ThreadCreate] Thread "${thread.name}" does not have rebrand tag ${settings.rebrand_tag_id}. Ignoring.`);
    return;
  }

  console.log(`[ThreadCreate] Rebrand tag matched on thread "${thread.name}"! Setting up proposal...`);
  await syncThreadProposal(thread, settings, db);
}

export async function handleThreadUpdate(
  oldThread: ThreadChannel,
  newThread: ThreadChannel,
  db: RebrandDatabase = database
): Promise<void> {
  const guild = newThread.guild;
  if (!guild) return;

  const settings = db.getGuildSettings(guild.id);
  if (!settings.forum_channel_id || !settings.rebrand_tag_id) {
    return;
  }

  if (newThread.parentId !== settings.forum_channel_id) {
    return;
  }

  const hadRebrandTag = oldThread.appliedTags?.includes(settings.rebrand_tag_id);
  const hasRebrandTag = newThread.appliedTags?.includes(settings.rebrand_tag_id);

  if (!hadRebrandTag && hasRebrandTag) {
    console.log(`[ThreadUpdate] Rebrand tag added to thread "${newThread.name}" (${newThread.id})`);
    await syncThreadProposal(newThread, settings, db);
    return;
  }

  if (hadRebrandTag && !hasRebrandTag) {
    const proposal = db.getProposalByThreadId(newThread.id);
    if (!proposal) return;

    // Check if the tag removal was due to the bot switching to Approved or Declined tag,
    // or if the proposal was already resolved (approved, rejected, or cancelled):
    const hasApprovedTag = Boolean(settings.approved_tag_id && newThread.appliedTags?.includes(settings.approved_tag_id));
    const hasDeclinedTag = Boolean(settings.declined_tag_id && newThread.appliedTags?.includes(settings.declined_tag_id));
    const isAlreadyResolved = proposal.status === "approved" || proposal.status === "rejected" || proposal.status === "cancelled";

    if (hasApprovedTag || hasDeclinedTag || isAlreadyResolved) {
      console.log(
        `[ThreadUpdate] Rebrand tag transitioned to status tag on thread "${newThread.name}" (Proposal #${proposal.id} Status: ${proposal.status}). Ignoring tag removal.`
      );
      return;
    }

    // The tag was removed by a moderator because the thread is NOT considered a rebrand proposal.
    console.log(
      `[ThreadUpdate] Rebrand tag was removed by moderator from pending thread "${newThread.name}". Cancelling proposal #${proposal.id}...`
    );
    db.cancelProposal(proposal.id);

    if (proposal.message_id) {
      const cardMsg = await newThread.messages.fetch(proposal.message_id).catch(() => null);
      if (cardMsg && typeof cardMsg.edit === "function") {
        const cancelledProposal = db.getProposal(proposal.id)!;
        const cardEmbed = createProposalEmbed(cancelledProposal, settings.min_upvotes);
        await cardMsg.edit({ embeds: [cardEmbed], components: [] }).catch(() => null);
      }
    }
  }
}

/**
 * Handles author uploading an image file directly into the proposal thread.
 */
export async function handleThreadMessage(message: Message, db: RebrandDatabase = database): Promise<void> {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;
  if (message.attachments.size === 0) return;

  const thread = message.channel as ThreadChannel;
  const proposal = db.getProposalByThreadId(thread.id);
  if (!proposal) return;

  const isAuthor = proposal.user_id === message.author.id || thread.ownerId === message.author.id;
  if (!isAuthor) return;

  const imgAttachment = message.attachments.find(
    (a) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.name)
  );
  if (!imgAttachment) return;

  console.log(`[ThreadMessage] Detected uploaded image "${imgAttachment.name}" from author @${message.author.tag} in thread ${thread.id}`);
  try {
    const cached = await rebrandService.downloadAndCacheImage(imgAttachment.url, `proposal_${thread.guild.id}`);
    const cleanName = proposal.name === "Pending Rebrand" ? thread.name.replace(/^\[Rebrand\]\s*/i, "") : proposal.name;
    const updated = db.updateProposalDetails(proposal.id, {
      icon_url: imgAttachment.url,
      icon_path: cached.filePath,
      is_ready: 1,
      name: cleanName,
    })!;

    const settings = db.getGuildSettings(thread.guild.id);
    if (proposal.message_id) {
      const card = await thread.messages.fetch(proposal.message_id).catch(() => null);
      if (card) {
        await card.edit({
          embeds: [createProposalEmbed(updated, settings.min_upvotes)],
          components: [createProposalActionRow(updated, settings.min_upvotes)],
        }).catch(() => null);
      }
    }

    await rebrandService.checkAndNotifyAdminLogs(thread.guild, updated.id);

    const success = createSuccessEmbed(
      "✅ Server Icon Uploaded & Verified",
      `Server icon updated from your upload for Proposal **#${updated.id} ("${updated.name}")**!`
    );
    success.setThumbnail(imgAttachment.url);
    await message.reply({ embeds: [success] }).catch(() => null);
  } catch (err: any) {
    console.error("[ThreadMessage] Error validating author uploaded image:", err);
  }
}

export async function handleReactionEvent(
  reaction: MessageReaction,
  user: User,
  db: RebrandDatabase = database
): Promise<void> {
  if (user.bot) return;

  const channel = reaction.message.channel;
  if (!channel.isThread()) return;

  const thread = channel as ThreadChannel;
  const guild = thread.guild;
  if (!guild) return;

  const proposal = db.getProposalByThreadId(thread.id);
  if (!proposal) return;

  const settings = db.getGuildSettings(guild.id);

  let starterMessage: any = null;
  if (typeof thread.fetchStarterMessage === "function") {
    starterMessage = await thread.fetchStarterMessage().catch(() => null);
  }
  if (!starterMessage && thread.messages?.fetch) {
    starterMessage = await thread.messages.fetch(thread.id).catch(() => null);
  }

  const starterId = starterMessage?.id ?? thread.id;
  const proposalMessageId = proposal.message_id;

  if (!shouldCountReaction(reaction.message.id, starterId, proposalMessageId)) {
    console.log(`[Reaction] Ignored reaction on message ${reaction.message.id} (not thread starter post).`);
    return;
  }

  const isUp = isUpvoteEmoji(reaction.emoji, settings.custom_upvote_emojis);
  const isDown = isDownvoteEmoji(reaction.emoji, settings.custom_downvote_emojis);

  if (!isUp && !isDown) {
    return;
  }

  const emojiDisplay = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : (reaction.emoji.name || "?");
  console.log(`[Reaction] User @${user.tag || user.id} reacted with ${emojiDisplay} on proposal #${proposal.id} in thread "${thread.name}"`);

  if (starterMessage?.reactions?.cache) {
    const authorIds = new Set<string>();
    if (proposal.user_id) authorIds.add(proposal.user_id);
    if (thread.ownerId) authorIds.add(thread.ownerId);
    if (starterMessage.author?.id) authorIds.add(starterMessage.author.id);

    const { upvotes, downvotes } = await collectVoteUserIds(
      starterMessage.reactions.cache,
      authorIds,
      settings.custom_upvote_emojis,
      settings.custom_downvote_emojis
    );

    db.setVotesForProposal(proposal.id, upvotes, downvotes);
    const updatedProposal = db.getProposal(proposal.id)!;

    console.log(
      `[Reaction] Proposal #${updatedProposal.id} vote count updated: ⬆️ ${updatedProposal.upvotes_count} | ⬇️ ${updatedProposal.downvotes_count} (Net: ${updatedProposal.net_votes})`
    );

    if (proposal.message_id) {
      const cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
      if (cardMsg) {
        const embed = createProposalEmbed(updatedProposal, settings.min_upvotes);
        const row = createProposalActionRow(updatedProposal, settings.min_upvotes);
        await cardMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
      }
    }

    if (
      updatedProposal.status === "pending" &&
      updatedProposal.is_ready === 1 &&
      updatedProposal.upvotes_count >= settings.min_upvotes
    ) {
      console.log(`[Reaction] Proposal #${updatedProposal.id} reached upvote goal (${updatedProposal.upvotes_count}/${settings.min_upvotes}). Sending to admin logs...`);
      await rebrandService.checkAndNotifyAdminLogs(guild, updatedProposal.id);
    }
  }
}
