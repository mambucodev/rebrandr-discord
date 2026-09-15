import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Guild,
  PermissionsBitField,
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import type { Proposal, ProposalWithVotes, Suggestion, GuildSettings } from "../database";
import { formatWeekendDate } from "../utils/dateUtils";

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

  // Expressive color palette depending on proposal state
  let statusColor = 0x5865f2; // Blurple default
  let statusBadge = "🔵 **Voting Active**";

  if (proposal.status === "active") {
    statusColor = 0xff73fa; // Electric Magenta
    statusBadge = "🟣 **LIVE THIS WEEKEND**";
  } else if (proposal.status === "approved") {
    statusColor = 0x57f287; // Emerald Green
    statusBadge = `🟢 **Approved & Scheduled**`;
  } else if (proposal.status === "rejected") {
    statusColor = 0xed4245; // Coral Red
    statusBadge = "🔴 **Declined**";
  } else if (!isReady) {
    statusColor = 0xfee75c; // Amber Gold
    statusBadge = "🟡 **Needs Icon Upload**";
  } else if (proposal.upvotes_count >= minUpvotes) {
    statusColor = 0x2ecc71; // Mint Green
    statusBadge = "⭐ **Goal Reached — Sent to Admins**";
  }

  const progressBar = createVoteProgressBar(proposal.upvotes_count, minUpvotes);

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "WEEKEND REBRAND PROPOSAL",
    })
    .setTitle(`✨ Proposal #${proposal.id} — ${proposal.name}`)
    .setColor(statusColor)
    .setTimestamp(new Date(proposal.created_at))
    .setFooter({
      text: "React ⬆️ or ⬇️ on the thread starter post to vote • Self-votes excluded",
    });

  // Expressive description with clean blockquote styling
  const topicText = proposal.topic
    ? `> 🎭 **Theme & Vision**\n> *${proposal.topic}*`
    : `> 🎭 **Theme & Vision**\n> *No theme description provided yet. Click "Edit Details" below to add one!*`;

  embed.setDescription(
    `${topicText}\n\n**Proposed Server Name:** \`${proposal.name}\``
  );

  embed.addFields(
    { name: "👑 Creator", value: `<@${proposal.user_id}>`, inline: true },
    { name: "📌 Status", value: statusBadge, inline: true },
    {
      name: "🖼️ Server Icon",
      value: hasIcon ? "✅ Uploaded & Verified" : "⚠️ *Not uploaded yet*",
      inline: true,
    },
    {
      name: "🗳️ Community Voting",
      value: `⬆️ **${proposal.upvotes_count}** Upvotes   •   ⬇️ **${proposal.downvotes_count}** Downvotes   •   Net: **${proposal.net_votes}**\n${progressBar}`,
      inline: false,
    }
  );

  if (proposal.scheduled_date) {
    embed.addFields({
      name: "📅 Target Weekend",
      value: `**${formatWeekendDate(proposal.scheduled_date)}**`,
      inline: true,
    });
  }

  // Display the uploaded server icon preview in the top-right corner thumbnail
  if (proposal.icon_url) {
    embed.setThumbnail(proposal.icon_url);
  }

  return embed;
}

/**
 * Clean, well-proportioned interactive buttons for the in-thread proposal card.
 */
export function createProposalActionRow(
  proposal: ProposalWithVotes,
  minUpvotes: number
): ActionRowBuilder<ButtonBuilder> {
  const uploadBtn = new ButtonBuilder()
    .setCustomId(`rebrand_upload_icon:${proposal.id}`)
    .setLabel(proposal.icon_url ? "Change Icon" : "Upload Icon")
    .setStyle(proposal.icon_url ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setEmoji("📸");

  const editBtn = new ButtonBuilder()
    .setCustomId(`rebrand_open_modal:${proposal.id}`)
    .setLabel("Edit Details")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("📝");

  const suggestBtn = new ButtonBuilder()
    .setCustomId(`rebrand_suggest_modal:${proposal.id}`)
    .setLabel("Suggest Asset")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("💡");

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

export function createProposalsListEmbed(proposals: ProposalWithVotes[], guild: Guild, minUpvotes: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "COMMUNITY PROPOSALS QUEUE" })
    .setTitle(`🗳️ Pending Rebrand Proposals — ${guild.name}`)
    .setColor(0xffa502)
    .setTimestamp()
    .setFooter({ text: `Required Upvotes: ${minUpvotes} + Admin Approval in Logs` });

  if (proposals.length === 0) {
    embed.setDescription("There are no pending proposals right now. Create a forum thread with the rebrand tag!");
    return embed;
  }

  const lines = proposals.map((p) => {
    const readyForOwner = p.upvotes_count >= minUpvotes ? "⭐ **[Goal Met - Sent to Logs]**" : `⏳ (${p.upvotes_count}/${minUpvotes} upvotes)`;
    return `• **#${p.id} — \`${p.name}\`**\n  Topic: ${p.topic || "*No topic*"} | By: <@${p.user_id}>\n  Reactions: ⬆️ ${p.upvotes_count} | ⬇️ ${p.downvotes_count} • Status: ${readyForOwner}`;
  });

  embed.setDescription(lines.join("\n\n"));
  return embed;
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
        name: "📫 Rebrand Forum Channel",
        value: settings.forum_channel_id ? `<#${settings.forum_channel_id}>` : "*Not set*",
        inline: true,
      },
      {
        name: "🏷️ Configured Forum Tag",
        value: settings.rebrand_tag_id ? `\`${settings.rebrand_tag_id}\`` : "*Not set*",
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

export function hasAdminPermission(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;

  const permissions = interaction.memberPermissions;
  if (!permissions) return false;

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}
