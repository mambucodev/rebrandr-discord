import {
  EmbedBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  Guild,
  ForumChannel,
  PermissionsBitField,
  ChatInputCommandInteraction,
  ButtonInteraction,
  MessageFlags,
} from "discord.js";
import type { Proposal, ProposalWithVotes, Suggestion, GuildSettings } from "../database";
import { formatWeekendDate } from "../utils/dateUtils";
import { config } from "../config";

/**
 * Converts a standard EmbedBuilder (or existing ContainerBuilder) and optional ActionRows
 * into a Discord Components V2 ContainerBuilder.
 *
 * In Discord Components V2, placing ActionRowBuilder inside ContainerBuilder causes
 * interaction buttons to render INSIDE the embed card instead of beneath it.
 */
export function embedToContainer(
  embedOrContainer: EmbedBuilder | ContainerBuilder,
  actionRows: ActionRowBuilder<any>[] | ActionRowBuilder<any> = []
): ContainerBuilder {
  if (embedOrContainer instanceof ContainerBuilder) {
    const rows = Array.isArray(actionRows) ? actionRows : [actionRows];
    if (rows.length > 0) {
      embedOrContainer.addActionRowComponents(...rows);
    }
    return embedOrContainer;
  }

  const embed = embedOrContainer;
  const container = new ContainerBuilder();
  const data = embed.data;

  if (data.color) {
    container.setAccentColor(data.color);
  }

  const textParts: string[] = [];
  if (data.author?.name) {
    textParts.push(`**${data.author.name}**`);
  }
  if (data.title) {
    textParts.push(`## ${data.title}`);
  }
  if (data.description) {
    textParts.push(data.description);
  }
  if (data.fields && data.fields.length > 0) {
    if (textParts.length > 0) textParts.push("");
    for (const field of data.fields) {
      textParts.push(`**${field.name}**\n${field.value}`);
    }
  }

  const footerParts: string[] = [];
  if (data.footer?.text) {
    footerParts.push(data.footer.text);
  }
  if (data.timestamp) {
    const ts = Math.floor(new Date(data.timestamp).getTime() / 1000);
    if (!isNaN(ts)) {
      footerParts.push(`<t:${ts}:R>`);
    }
  }
  if (footerParts.length > 0) {
    textParts.push("");
    textParts.push(`-# ${footerParts.join(" • ")}`);
  }

  const fullText = textParts.join("\n");

  if (data.thumbnail?.url) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(fullText || " "))
      .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: data.thumbnail.url } }));
    container.addSectionComponents(section);
  } else if (fullText.trim().length > 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fullText));
  }

  if (data.image?.url) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(data.image.url)
      )
    );
  }

  const rows = Array.isArray(actionRows) ? actionRows : [actionRows];
  if (rows.length > 0) {
    container.addActionRowComponents(...rows);
  }

  return container;
}

export interface ContainerPayloadOptions {
  ephemeral?: boolean;
}

/**
 * Builds a message payload using Discord Components V2.
 * Interactive action rows (buttons & select menus) are nested inside the container.
 */
export function toContainerPayload(
  embedOrContainer: EmbedBuilder | ContainerBuilder,
  actionRows: ActionRowBuilder<any>[] | ActionRowBuilder<any> = [],
  options?: ContainerPayloadOptions
): { components: [ContainerBuilder]; flags: any } {
  const container = embedToContainer(embedOrContainer, actionRows);
  let flags: number = MessageFlags.IsComponentsV2;
  if (options?.ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }
  return {
    components: [container],
    flags: flags as any,
  };
}

/**
 * Builds a message update payload for interaction.update() using Discord Components V2.
 */
export function toContainerUpdatePayload(
  embedOrContainer: EmbedBuilder | ContainerBuilder,
  actionRows: ActionRowBuilder<any>[] | ActionRowBuilder<any> = []
): { components: [ContainerBuilder]; flags: any } {
  const container = embedToContainer(embedOrContainer, actionRows);
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as any,
  };
}

/**
 * Extracts and concatenates all text content from a ContainerBuilder or message payload.
 * Useful for inspecting container contents in tests and handlers.
 */
export function getContainerText(containerOrPayload: any): string {
  const container = containerOrPayload?.components?.[0]?.toJSON
    ? containerOrPayload.components[0].toJSON()
    : containerOrPayload?.toJSON
    ? containerOrPayload.toJSON()
    : containerOrPayload?.components?.[0] || containerOrPayload;
  if (!container) return "";
  const texts: string[] = [];
  for (const c of container.components || []) {
    if (c.type === 10 && typeof c.content === "string") texts.push(c.content);
    if (c.type === 9 && Array.isArray(c.components)) {
      for (const sub of c.components) {
        if (sub.type === 10 && typeof sub.content === "string") texts.push(sub.content);
      }
    }
  }
  return texts.join("\n");
}

export function createVoteProgressBar(current: number, target: number, barLength: number = 8): string {
  const clamped = Math.max(0, current);
  const ratio = Math.min(clamped / Math.max(target, 1), 1);
  const filled = Math.round(ratio * barLength);
  const empty = barLength - filled;
  const percentage = Math.round(ratio * 100);
  return `${"▰".repeat(filled)}${"▱".repeat(empty)} **${percentage}%** (${clamped}/${target} votes)`;
}

export function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xed4245)
    .setTimestamp();
}

export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x57f287)
    .setTimestamp();
}

export function createInfoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x5865f2)
    .setTimestamp();
}

/**
 * Modern, expressive proposal card embed for the forum thread.
 * Highlights the server icon as thumbnail, colorful status badges, and an expressive voting bar.
 */
export function createProposalEmbed(proposal: ProposalWithVotes, minUpvotes: number): EmbedBuilder {
  const hasIcon = Boolean(proposal.icon_url || proposal.icon_path);
  const isReady = proposal.is_ready === 1 && hasIcon;

  let statusColor = 0x5865f2; // Blurple default
  let statusText = "Voting Active";

  if (proposal.status === "active") {
    statusColor = 0xff73fa;
    statusText = "Live This Weekend";
  } else if (proposal.status === "approved") {
    statusColor = 0x57f287;
    statusText = "Approved & Scheduled";
  } else if (proposal.status === "rejected") {
    statusColor = 0xed4245;
    statusText = "Declined";
  } else if (proposal.status === "cancelled") {
    statusColor = 0x95a5a6;
    statusText = "Cancelled";
  } else if (!isReady) {
    statusColor = 0xfee75c;
    statusText = "Needs Icon";
  } else if (proposal.upvotes_count >= minUpvotes) {
    statusColor = 0x2ecc71;
    statusText = "Goal Reached";
  }

  const progressBar = createVoteProgressBar(proposal.upvotes_count, minUpvotes);

  const themeText = proposal.topic
    ? `> *${proposal.topic}*`
    : `> *No theme description provided yet. Click "Edit Details" below to add one!*`;

  const lines = [
    `### Status: ${statusText}`,
    "",
    themeText,
    "",
    "### Details",
    `• **Creator:** <@${proposal.user_id}>`,
    `• **Icon:** ${hasIcon ? "Uploaded" : "Not Uploaded"}`,
  ];

  if (proposal.scheduled_date) {
    lines.push(`• **Target Weekend:** ${formatWeekendDate(proposal.scheduled_date)}`);
  }

  lines.push(
    "",
    "### Voting",
    `⬆️ **${proposal.upvotes_count}**   •   ⬇️ **${proposal.downvotes_count}**   •   Net: **${proposal.net_votes}**`,
    "",
    progressBar
  );

  const embed = new EmbedBuilder()
    .setTitle(`Proposal #${proposal.id} — ${proposal.name}`)
    .setDescription(lines.join("\n"))
    .setColor(statusColor)
    .setTimestamp(new Date(proposal.created_at))
    .setFooter({
      text: "React ⬆️ or ⬇️ on the thread starter post to vote • Self-votes excluded",
    });

  if (proposal.icon_url) {
    embed.setThumbnail(proposal.icon_url);
  }

  return embed;
}

export function createProposalActionRow(
  proposal: ProposalWithVotes,
  minUpvotes: number
): ActionRowBuilder<ButtonBuilder> {
  const uploadBtn = new ButtonBuilder()
    .setCustomId(`rebrand_upload_icon:${proposal.id}`)
    .setLabel(proposal.icon_url ? "Change Icon" : "Upload Icon")
    .setStyle(proposal.icon_url ? ButtonStyle.Secondary : ButtonStyle.Primary);

  const editBtn = new ButtonBuilder()
    .setCustomId(`rebrand_open_modal:${proposal.id}`)
    .setLabel("Edit Details")
    .setStyle(ButtonStyle.Secondary);

  const suggestBtn = new ButtonBuilder()
    .setCustomId(`rebrand_suggest_modal:${proposal.id}`)
    .setLabel("Suggest Asset")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(uploadBtn, editBtn, suggestBtn);
}

export function createSuggestionEmbed(suggestion: Suggestion, proposal: Proposal): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "COMMUNITY ASSET SUGGESTION" })
    .setTitle(`💡 New Rebrand Asset Suggestion — Proposal #${proposal.id}`)
    .setDescription(
      `Community member <@${suggestion.user_id}> suggested assets for **#${proposal.id} (${proposal.name})**:\n\n> *${suggestion.topic || "No topic description."}*`
    )
    .addFields(
      { name: "Proposed Name", value: `\`${suggestion.name}\``, inline: true },
      { name: "Suggested By", value: `<@${suggestion.user_id}>`, inline: true }
    )
    .setColor(0x3498db)
    .setThumbnail(suggestion.icon_url)
    .setFooter({ text: "Only the thread author or server admins can accept this suggestion." })
    .setTimestamp();

  return embed;
}

export function createSuggestionActionRow(suggestionId: number): ActionRowBuilder<ButtonBuilder> {
  const acceptBtn = new ButtonBuilder()
    .setCustomId(`rebrand_accept_suggest:${suggestionId}`)
    .setLabel("Accept Suggestion")
    .setStyle(ButtonStyle.Success)
    .setEmoji("✅");

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`rebrand_reject_suggest:${suggestionId}`)
    .setLabel("Decline")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("✖️");

  return new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, rejectBtn);
}

export function createAdminLogApprovalEmbed(
  proposal: ProposalWithVotes,
  guild: Guild,
  threadUrl?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "🛡️ ADMIN ACTION REQUIRED" })
    .setTitle(`👑 Proposal #${proposal.id} Ready for Approval!`)
    .setDescription(
      `Proposal **#${proposal.id} ("${proposal.name}")** has reached the community vote goal!\n\nReview the proposed assets below and decide whether to approve it for an upcoming weekend rebrand.`
    )
    .setColor(0xf1c40f)
    .addFields(
      { name: "🏷️ Server Name", value: `\`${proposal.name}\``, inline: true },
      { name: "👤 Submitter", value: `<@${proposal.user_id}>`, inline: true },
      {
        name: "🗳️ Final Tally",
        value: `⬆️ **${proposal.upvotes_count}** upvotes (Net: +${proposal.net_votes})`,
        inline: true,
      },
      { name: "🎭 Theme / Concept", value: proposal.topic || "*No topic provided*", inline: false }
    )
    .setFooter({ text: "Use buttons below to approve or decline this rebrand" })
    .setTimestamp();

  if (threadUrl) {
    embed.addFields({ name: "🔗 Forum Thread", value: `[Jump to Proposal Thread](${threadUrl})`, inline: false });
  }

  if (proposal.icon_url) {
    embed.setThumbnail(proposal.icon_url);
    embed.setImage(proposal.icon_url);
  }

  return embed;
}

export function createAdminLogActionRow(proposalId: number): ActionRowBuilder<ButtonBuilder> {
  const approveBtn = new ButtonBuilder()
    .setCustomId(`rebrand_log_approve:${proposalId}`)
    .setLabel("Approve & Schedule")
    .setStyle(ButtonStyle.Success)
    .setEmoji("👑");

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`rebrand_log_reject:${proposalId}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("❌");

  return new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn);
}

export function createConfirmationActionRow(
  actionType: "approve" | "reject",
  proposalId: number
): ActionRowBuilder<ButtonBuilder> {
  const confirmBtn = new ButtonBuilder()
    .setCustomId(`rebrand_confirm_${actionType}:${proposalId}`)
    .setLabel(actionType === "approve" ? "Confirm Approval" : "Confirm Rejection")
    .setStyle(actionType === "approve" ? ButtonStyle.Success : ButtonStyle.Danger)
    .setEmoji(actionType === "approve" ? "✅" : "🗑️");

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`rebrand_cancel_action:${proposalId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("↩️");

  return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

export function createRebrandLiveEmbed(proposal: Proposal, guild: Guild): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: "WEEKEND REBRAND IS LIVE" })
    .setTitle(`🎉 The Server Has Rebranded: ${proposal.name}! 🎉`)
    .setDescription(
      `Welcome to this weekend's transformed server!\nEnjoy the new look until **Monday 00:00 UTC**.`
    )
    .setColor(0xff73fa)
    .addFields(
      { name: "🏷️ Server Name", value: `**${proposal.name}**`, inline: true },
      { name: "🎭 Theme / Concept", value: proposal.topic || "*Community Special*", inline: true },
      { name: "💡 Proposed By", value: `<@${proposal.user_id}>`, inline: true },
      { name: "⏰ Duration", value: "Active until **Monday 00:00 UTC**", inline: false }
    )
    .setImage(proposal.icon_url)
    .setThumbnail(guild.iconURL() || proposal.icon_url)
    .setTimestamp()
    .setFooter({ text: "Weekend Rebrand • UTC" });
}

export function createRebrandConcludedEmbed(proposal: Proposal | null, guild: Guild): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "WEEKEND REBRAND CONCLUDED" })
    .setTitle("✨ Server Restored to Default Baseline ✨")
    .setDescription(
      `The weekend rebrand has ended! Server name and icon have been safely restored to default.\n\nThank you to everyone who participated!`
    )
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: "Weekend Rebrand • UTC" });

  if (proposal) {
    embed.addFields(
      { name: "Concluded Rebrand", value: `**${proposal.name}**`, inline: true },
      { name: "Theme", value: proposal.topic || "*N/A*", inline: true }
    );
  }

  if (guild.iconURL()) {
    embed.setThumbnail(guild.iconURL());
  }

  return embed;
}

export function createScheduleEmbed(proposals: ProposalWithVotes[], guild: Guild): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "WEEKEND REBRAND CALENDAR" })
    .setTitle(`📅 Weekend Rebrand Schedule — ${guild.name}`)
    .setColor(0x00a8ff)
    .setTimestamp()
    .setFooter({ text: "Post in our rebrand forum to submit an idea!" });

  if (proposals.length === 0) {
    embed.setDescription("No weekend rebrands are currently scheduled!\nCreate a tagged forum thread to propose one.");
    return embed;
  }

  const lines = proposals.map((p, idx) => {
    const dateFormatted = p.scheduled_date ? formatWeekendDate(p.scheduled_date) : "TBD";
    const statusBadge = p.status === "active" ? "🟢 **[LIVE NOW]**" : "🗓️";
    return `${idx + 1}. ${statusBadge} **${dateFormatted}**\n   • **Name:** \`${p.name}\`\n   • **Topic:** ${p.topic || "*None*"}\n   • **By:** <@${p.user_id}> (ID: \`#${p.id}\`)`;
  });

  embed.setDescription(lines.join("\n\n"));
  return embed;
}

export function categorizeAndSortProposals(
  proposals: ProposalWithVotes[],
  minUpvotes: number
): {
  readyToApprove: ProposalWithVotes[];
  goalReachedMissingAssets: ProposalWithVotes[];
  votingInProgress: ProposalWithVotes[];
  allSorted: ProposalWithVotes[];
} {
  const readyToApprove: ProposalWithVotes[] = [];
  const goalReachedMissingAssets: ProposalWithVotes[] = [];
  const votingInProgress: ProposalWithVotes[] = [];

  for (const p of proposals) {
    const hasIcon = Boolean(p.icon_url || p.icon_path);
    const hasRequiredAssets = hasIcon && p.name && p.name !== "Pending Rebrand";

    if (p.upvotes_count >= minUpvotes && hasRequiredAssets) {
      readyToApprove.push(p);
    } else if (p.upvotes_count >= minUpvotes) {
      goalReachedMissingAssets.push(p);
    } else {
      votingInProgress.push(p);
    }
  }

  const sortDesc = (a: ProposalWithVotes, b: ProposalWithVotes) => {
    if (b.upvotes_count !== a.upvotes_count) return b.upvotes_count - a.upvotes_count;
    if (b.net_votes !== a.net_votes) return b.net_votes - a.net_votes;
    return a.id - b.id;
  };

  readyToApprove.sort(sortDesc);
  goalReachedMissingAssets.sort(sortDesc);
  votingInProgress.sort(sortDesc);

  return {
    readyToApprove,
    goalReachedMissingAssets,
    votingInProgress,
    allSorted: [...readyToApprove, ...goalReachedMissingAssets, ...votingInProgress],
  };
}

export function createProposalsListEmbed(
  proposals: ProposalWithVotes[],
  guild: Guild,
  minUpvotes: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "COMMUNITY PROPOSALS QUEUE" })
    .setTitle(`🗳️ Rebrand Proposals Queue — ${guild.name}`)
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({
      text: `Required Upvotes: ${minUpvotes} • Use "/proposals browse" for interactive view`,
    });

  if (proposals.length === 0) {
    embed.setDescription(
      "There are no pending proposals right now.\nPost your rebrand idea in the forum to get started!"
    );
    return embed;
  }

  const { readyToApprove, goalReachedMissingAssets, votingInProgress } =
    categorizeAndSortProposals(proposals, minUpvotes);

  const formatProposalLine = (p: ProposalWithVotes, includeProgress: boolean = false): string => {
    const threadLink = p.thread_id
      ? `<#${p.thread_id}> ([Jump to Thread](https://discord.com/channels/${p.guild_id || guild.id}/${p.thread_id}))`
      : "*No thread*";
    const hasIcon = Boolean(p.icon_url || p.icon_path);
    const iconBadge = hasIcon ? "🖼️ Icon: Ready" : "⚠️ Missing Icon";

    const lines = [
      `• **#${p.id} — \`${p.name}\`**`,
      `  👤 <@${p.user_id}> | 🔗 ${threadLink}`,
      `  🗳️ ⬆️ **${p.upvotes_count}** / ⬇️ **${p.downvotes_count}** (Net: **${p.net_votes >= 0 ? "+" : ""}${p.net_votes}**) • ${iconBadge}`,
    ];

    if (includeProgress) {
      lines.push(`  ${createVoteProgressBar(p.upvotes_count, minUpvotes, 6)}`);
    }

    return lines.join("\n");
  };

  const sections: string[] = [];

  // Section 1: Ready for Approval
  const readyContent =
    readyToApprove.length > 0
      ? readyToApprove.map((p) => formatProposalLine(p)).join("\n\n")
      : "*None currently in this tier.*";
  sections.push(`### 👑 Ready for Approval (${readyToApprove.length})\n${readyContent}`);

  // Section 2: Goal Reached, Missing Assets
  const missingContent =
    goalReachedMissingAssets.length > 0
      ? goalReachedMissingAssets.map((p) => formatProposalLine(p)).join("\n\n")
      : "*None currently in this tier.*";
  sections.push(`### 🟡 Goal Reached — Missing Assets (${goalReachedMissingAssets.length})\n${missingContent}`);

  // Section 3: In Progress / Voting Active
  const votingContent =
    votingInProgress.length > 0
      ? votingInProgress.map((p) => formatProposalLine(p, true)).join("\n\n")
      : "*None currently in this tier.*";
  sections.push(`### ⏳ Voting in Progress (${votingInProgress.length})\n${votingContent}`);

  embed.setDescription(sections.join("\n\n---\n\n"));
  return embed;
}

export function createProposalCarouselEmbed(
  proposal: ProposalWithVotes,
  minUpvotes: number,
  index: number,
  total: number,
  guild: Guild
): EmbedBuilder {
  const hasIcon = Boolean(proposal.icon_url || proposal.icon_path);
  const isReady = proposal.upvotes_count >= minUpvotes && hasIcon && proposal.name !== "Pending Rebrand";

  let statusBadge = "⏳ Voting in Progress";
  let statusColor = 0x5865f2;

  if (isReady) {
    statusBadge = "🟢 Ready for Admin Approval";
    statusColor = 0x57f287;
  } else if (proposal.upvotes_count >= minUpvotes) {
    statusBadge = "🟡 Goal Reached — Needs Server Icon";
    statusColor = 0xf1c40f;
  }

  const threadLink = proposal.thread_id
    ? `<#${proposal.thread_id}> ([Jump to Thread](https://discord.com/channels/${proposal.guild_id || guild.id}/${proposal.thread_id}))`
    : "*No thread linked*";

  const iconText = hasIcon
    ? "✅ Uploaded & Ready"
    : "⚠️ Not Uploaded Yet *(Submitter can use `/rebrand upload`)*";

  const lines = [
    `### Status: ${statusBadge}`,
    "",
    proposal.topic ? `> *${proposal.topic}*` : `> *No theme description provided.*`,
    "",
    "### Details",
    `• **Creator:** <@${proposal.user_id}>`,
    `• **Forum Thread:** ${threadLink}`,
    `• **Server Icon:** ${iconText}`,
    "",
    "### Voting",
    `⬆️ **${proposal.upvotes_count}**   •   ⬇️ **${proposal.downvotes_count}**   •   Net: **${proposal.net_votes >= 0 ? "+" : ""}${proposal.net_votes}**`,
    "",
    createVoteProgressBar(proposal.upvotes_count, minUpvotes),
  ];

  const embed = new EmbedBuilder()
    .setAuthor({ name: "COMMUNITY PROPOSALS BROWSER" })
    .setTitle(`Proposal #${proposal.id} — ${proposal.name}`)
    .setDescription(lines.join("\n"))
    .setColor(statusColor)
    .setTimestamp(new Date(proposal.created_at))
    .setFooter({
      text: `Proposal ${index + 1} of ${total} • Required Upvotes: ${minUpvotes} • Use buttons below to navigate & manage`,
    });

  if (proposal.icon_url) {
    embed.setThumbnail(proposal.icon_url);
  }

  return embed;
}

export function createProposalCarouselActionRows(
  proposal: ProposalWithVotes,
  index: number,
  total: number,
  guildId: string
): ActionRowBuilder<ButtonBuilder>[] {
  const isFirst = index <= 0;
  const isLast = index >= total - 1;

  const firstBtn = new ButtonBuilder()
    .setCustomId("rebrand_prop_nav:first:0")
    .setLabel("⏮️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isFirst);

  const prevBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_nav:prev:${index - 1}`)
    .setLabel("◀️ Prev")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(isFirst);

  const countBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_nav:noop:${index}`)
    .setLabel(`${index + 1} / ${total}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_nav:next:${index + 1}`)
    .setLabel("Next ▶️")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(isLast);

  const lastBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_nav:last:${total - 1}`)
    .setLabel("⏭️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isLast);

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    firstBtn,
    prevBtn,
    countBtn,
    nextBtn,
    lastBtn
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>();

  if (proposal.thread_id) {
    const threadBtn = new ButtonBuilder()
      .setLabel("View Thread")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${proposal.thread_id}`)
      .setEmoji("🔗");
    actionRow.addComponents(threadBtn);
  }

  const approveBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_approve:${proposal.id}:${index}`)
    .setLabel("Approve & Schedule")
    .setStyle(ButtonStyle.Success)
    .setEmoji("👑");

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`rebrand_prop_reject:${proposal.id}:${index}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("❌");

  actionRow.addComponents(approveBtn, rejectBtn);

  return [navRow, actionRow];
}

export function createStatusEmbed(
  settings: GuildSettings,
  activeProposal: ProposalWithVotes | null,
  nextProposal: ProposalWithVotes | null,
  guild: Guild
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "SERVER CONFIGURATION & STATUS" })
    .setTitle(`⚙️ Weekend Rebrand Status — ${guild.name}`)
    .setColor(0x2ed573)
    .addFields(
      {
        name: "🛡️ Admin Logs Channel",
        value: settings.logs_channel_id ? `<#${settings.logs_channel_id}>` : "*Not set (approvals will not be logged)*",
        inline: true,
      },
      {
        name: "📬 Rebrand Forum Channel",
        value: settings.forum_channel_id ? `<#${settings.forum_channel_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "🏷️ Rebrand Forum Tag",
        value: settings.rebrand_tag_id ? `\`${settings.rebrand_tag_id}\`` : "*Not set*",
        inline: true,
      },
      {
        name: "✅ Approved Status Tag",
        value: settings.approved_tag_id ? `\`${settings.approved_tag_id}\`` : "*Not set (Optional)*",
        inline: true,
      },
      {
        name: "❌ Declined Status Tag",
        value: settings.declined_tag_id ? `\`${settings.declined_tag_id}\`` : "*Not set (Optional)*",
        inline: true,
      },
      {
        name: "🎯 Required Upvotes",
        value: `**${settings.min_upvotes}** upvotes`,
        inline: true,
      },
      {
        name: "⬆️ Upvote Emojis",
        value: settings.custom_upvote_emojis ? `\`${settings.custom_upvote_emojis}\`` : "*Default (⬆️, 👍, 🔺)*",
        inline: true,
      },
      {
        name: "⬇️ Downvote Emojis",
        value: settings.custom_downvote_emojis ? `\`${settings.custom_downvote_emojis}\`` : "*Default (⬇️, 👎, 🔻)*",
        inline: true,
      },
      {
        name: "🏷️ Default Server Name",
        value: settings.default_name ? `\`${settings.default_name}\`` : `\`${guild.name}\` *(auto-saved)*`,
        inline: true,
      },
      {
        name: "🖼️ Default Server Icon",
        value: settings.default_icon_url ? `[View Default Icon](${settings.default_icon_url})` : (guild.iconURL() ? `[Current Icon](${guild.iconURL()})` : "*No icon*"),
        inline: true,
      },
      {
        name: "🟢 Currently Active Rebrand",
        value: activeProposal
          ? `**#${activeProposal.id}: \`${activeProposal.name}\`**\nTopic: ${activeProposal.topic || "*N/A*"} (By: <@${activeProposal.user_id}>)`
          : "*None (Normal server state)*",
        inline: false,
      },
      {
        name: "⏭️ Next Scheduled Rebrand",
        value: nextProposal
          ? `**#${nextProposal.id}: \`${nextProposal.name}\`**\nWeekend: **${nextProposal.scheduled_date ? formatWeekendDate(nextProposal.scheduled_date) : "Next Available"}** (By: <@${nextProposal.user_id}>)`
          : "*No scheduled rebrands in queue*",
        inline: false,
      }
    )
    .setTimestamp();

  if (guild.iconURL()) {
    embed.setThumbnail(guild.iconURL());
  }

  return embed;
}

/**
 * Builds the interactive tag configuration embed and dropdown select menus
 * for selecting Rebrand, Approved, and Declined forum tags.
 */
export function createForumTagConfigEmbedAndRows(
  forumChan: ForumChannel,
  settings: GuildSettings
): {
  embed: EmbedBuilder;
  rows: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const availableTags = forumChan.availableTags;

  const rebrandTag = availableTags.find((t) => t.id === settings.rebrand_tag_id);
  const approvedTag = availableTags.find((t) => t.id === settings.approved_tag_id);
  const declinedTag = availableTags.find((t) => t.id === settings.declined_tag_id);

  const embed = new EmbedBuilder()
    .setTitle("🏷️ Configure Forum Status Tags")
    .setColor(0x5865f2)
    .setDescription(
      `Configure tags for forum <#${forumChan.id}>.\n` +
      `When a proposal changes status, the bot automatically swaps tags so **only one status tag** is assigned at a time.`
    )
    .addFields(
      {
        name: "🏷️ Rebrand Proposal Tag",
        value: rebrandTag ? `**${rebrandTag.name}** (\`${rebrandTag.id}\`)` : "*Not set (Select below)*",
        inline: false,
      },
      {
        name: "✅ Approved Status Tag",
        value: approvedTag ? `**${approvedTag.name}** (\`${approvedTag.id}\`)` : "*Not set (Optional)*",
        inline: true,
      },
      {
        name: "❌ Declined Status Tag",
        value: declinedTag ? `**${declinedTag.name}** (\`${declinedTag.id}\`)` : "*Not set (Optional)*",
        inline: true,
      }
    )
    .setFooter({
      text: "Selections save automatically • Only 1 status tag active at a time",
    });

  const baseOptions = availableTags.slice(0, 24).map((t) => ({
    label: t.name,
    value: t.id,
    description: `Tag ID: ${t.id}`,
    emoji: t.emoji?.name ? { name: t.emoji.name, id: t.emoji.id || undefined } : undefined,
  }));

  const makeRow = (
    type: "rebrand" | "approved" | "declined",
    placeholder: string,
    currentTagId: string | null
  ) => {
    const options = [
      {
        label: "None / Clear Tag",
        value: "clear",
        description: `Do not assign a ${type} tag`,
        default: !currentTagId,
      },
      ...baseOptions.map((opt) => ({
        ...opt,
        default: opt.value === currentTagId,
      })),
    ];

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rebrand_tag_select:${type}:${forumChan.id}`)
      .setPlaceholder(placeholder)
      .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  };

  const rows = [
    makeRow("rebrand", "🏷️ Select Rebrand Proposal Tag", settings.rebrand_tag_id),
    makeRow("approved", "✅ Select Approved Status Tag", settings.approved_tag_id),
    makeRow("declined", "❌ Select Declined Status Tag", settings.declined_tag_id),
  ];

  return { embed, rows };
}

export function hasAdminPermission(
  interaction: ChatInputCommandInteraction | ButtonInteraction | any
): boolean {
  if (!interaction.guild) return false;

  const userId =
    interaction.user?.id ||
    (interaction.member as any)?.user?.id ||
    (interaction.member as any)?.id;

  if (userId && config.adminUserIds.includes(userId)) return true;
  if (userId && interaction.guild.ownerId === userId) return true;

  const permissions = interaction.memberPermissions;
  if (!permissions) return false;

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

