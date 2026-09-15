import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ForumChannel,
  MessageFlags,
  ButtonInteraction,
  ThreadChannel,
  TextChannel,
} from "discord.js";
import { database } from "../database";
import { rebrandService } from "../services/rebrandService";
import { updateThreadStatusTag } from "../handlers/threadHandler";
import {
  createStatusEmbed,
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
  createErrorEmbed,
  createInfoEmbed,
  createForumTagConfigEmbedAndRows,
} from "../services/announcement";
import { formatWeekendDate } from "../utils/dateUtils";

export const rebrandAdminCommand = new SlashCommandBuilder()
  .setName("rebrand")
  .setDescription("Manage weekend rebrands, configuration, schedule, and overrides")
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("config")
      .setDescription("Configure forum channel, tags, admin logs, and upvote requirements")
      .addChannelOption((opt) =>
        opt
          .setName("forum_channel")
          .setDescription("Forum channel where rebrand proposals will be posted")
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("logs_channel")
          .setDescription("Private admin logs channel for approvals and activity")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("min_upvotes")
          .setDescription("Minimum upvotes required before admin approval (default: 4)")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("upvote_emojis")
          .setDescription("Custom upvote emojis or IDs (e.g. :hype_up: 🚀 separated by spaces or commas)")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("downvote_emojis")
          .setDescription("Custom downvote emojis or IDs (e.g. :hype_down: 💩 separated by spaces or commas)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("tags")
      .setDescription("Configure forum status tags for Rebrand, Approved, and Declined proposals")
      .addChannelOption((opt) =>
        opt
          .setName("forum_channel")
          .setDescription("Forum channel to configure tags for (leave empty to use currently configured channel)")
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("View current bot configuration and rebrand state")
  )
  .addSubcommand((sub) =>
    sub
      .setName("upload")
      .setDescription("Upload a custom server icon image directly for a rebrand proposal")
      .addAttachmentOption((opt) =>
        opt
          .setName("icon")
          .setDescription("The custom server icon image file (PNG, JPG, WEBP, GIF)")
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Proposal ID (leave empty if run inside the proposal forum thread)")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("Optionally update the proposed server name")
          .setMaxLength(100)
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("topic")
          .setDescription("Optionally update the proposed theme topic")
          .setMaxLength(250)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("set-default")
      .setDescription("Set the default baseline server name and icon to revert back to")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Default server name (leave empty to use current name)").setRequired(false)
      )
      .addAttachmentOption((opt) =>
        opt.setName("icon").setDescription("Default server icon image (leave empty to use current icon)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("approve")
      .setDescription("Approve a proposal and schedule it for an upcoming weekend")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Proposal ID to approve (leave empty to use current thread's proposal)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("reject")
      .setDescription("Reject a proposal")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Proposal ID to reject (leave empty to use current thread's proposal)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason for rejection").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("schedule").setDescription("View the upcoming rebrand queue and dates")
  )
  .addSubcommand((sub) =>
    sub
      .setName("trigger")
      .setDescription("Instantly trigger rebrand cycle (for testing or emergency override)")
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("Action to trigger")
          .setRequired(true)
          .addChoices(
            { name: "Apply Next Scheduled Rebrand", value: "apply" },
            { name: "Revert to Baseline Server Default", value: "revert" }
          )
      )
  );

export async function handleRebrandAdminCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasAdminPermission(interaction)) {
    const errorEmbed = createErrorEmbed(
      "Permission Denied",
      "You need **Administrator** or **Manage Server** permissions to run `/rebrand` admin commands."
    );
    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  console.log(`[Admin] Command "/rebrand ${sub}" invoked by @${interaction.user.tag} in guild "${interaction.guild.name}" (${guildId})`);

  switch (sub) {
    case "config": {
      const forumChan = interaction.options.getChannel("forum_channel") as ForumChannel | null;
      const logsChan = interaction.options.getChannel("logs_channel");
      const minVotes = interaction.options.getInteger("min_upvotes");
      const customUpvotes = interaction.options.getString("upvote_emojis");
      const customDownvotes = interaction.options.getString("downvote_emojis");

      const updates: Record<string, any> = {};
      if (logsChan) updates.logs_channel_id = logsChan.id;
      if (minVotes !== null && minVotes !== undefined) updates.min_upvotes = minVotes;
      if (customUpvotes !== null && customUpvotes !== undefined) updates.custom_upvote_emojis = customUpvotes.trim() || null;
      if (customDownvotes !== null && customDownvotes !== undefined) updates.custom_downvote_emojis = customDownvotes.trim() || null;

      if (forumChan) {
        updates.forum_channel_id = forumChan.id;
        const availableTags = forumChan.availableTags;
        console.log(`[Admin] Forum channel ${forumChan.name} has ${availableTags.length} available tags.`);

        const updatedSettings = database.updateGuildSettings(guildId, updates);

        if (availableTags.length > 0) {
          const { embed, rows } = createForumTagConfigEmbedAndRows(forumChan, updatedSettings);
          await interaction.reply({
            embeds: [embed],
            components: rows,
            flags: MessageFlags.Ephemeral,
          });
          return;
        } else {
          updates.rebrand_tag_id = null;
        }
      }

      const settings = database.updateGuildSettings(guildId, updates);
      console.log(`[Admin] Updated guild settings for "${interaction.guild.name}":`, updates);

      const configEmbed = new EmbedBuilder()
        .setTitle("⚙️ Weekend Rebrand Configuration Updated")
        .setColor(0x57f287)
        .addFields(
          {
            name: "🛡️ Admin Logs Channel",
            value: settings.logs_channel_id ? `<#${settings.logs_channel_id}>` : "*Not set*",
            inline: true,
          },
          {
            name: "📬 Forum Channel",
            value: settings.forum_channel_id ? `<#${settings.forum_channel_id}>` : "*Not set*",
            inline: true,
          },
          {
            name: "🏷️ Rebrand Tag ID",
            value: settings.rebrand_tag_id ? `\`${settings.rebrand_tag_id}\`` : "*Not set*",
            inline: true,
          },
          {
            name: "✅ Approved Tag ID",
            value: settings.approved_tag_id ? `\`${settings.approved_tag_id}\`` : "*Not set*",
            inline: true,
          },
          {
            name: "❌ Declined Tag ID",
            value: settings.declined_tag_id ? `\`${settings.declined_tag_id}\`` : "*Not set*",
            inline: true,
          },
          {
            name: "🎯 Required Upvotes",
            value: `**${settings.min_upvotes}**`,
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
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [configEmbed], flags: MessageFlags.Ephemeral });
      break;
    }

    case "tags": {
      let forumChan = interaction.options.getChannel("forum_channel") as ForumChannel | null;
      const settings = database.getGuildSettings(guildId);

      if (!forumChan && settings.forum_channel_id) {
        forumChan = (await interaction.guild.channels.fetch(settings.forum_channel_id).catch(() => null)) as ForumChannel | null;
      }

      if (!forumChan) {
        const errEmbed = createErrorEmbed(
          "Forum Channel Required",
          "No forum channel is configured yet. Please specify `forum_channel` or configure it using `/rebrand config`."
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (!forumChan.availableTags || forumChan.availableTags.length === 0) {
        const errEmbed = createErrorEmbed(
          "No Tags Found",
          `Forum channel <#${forumChan.id}> has no tags created yet. Please create tags in Discord forum channel settings first.`
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (forumChan.id !== settings.forum_channel_id) {
        database.updateGuildSettings(guildId, { forum_channel_id: forumChan.id });
      }

      const currentSettings = database.getGuildSettings(guildId);
      const { embed, rows } = createForumTagConfigEmbedAndRows(forumChan, currentSettings);
      await interaction.reply({
        embeds: [embed],
        components: rows,
        flags: MessageFlags.Ephemeral,
      });
      break;
    }

    case "upload": {
      const icon = interaction.options.getAttachment("icon", true);
      let proposalId = interaction.options.getInteger("id");
      const name = interaction.options.getString("name");
      const topic = interaction.options.getString("topic");

      if (!proposalId && interaction.channel?.isThread()) {
        const threadProposal = database.getProposalByThreadId(interaction.channel.id);
        if (threadProposal) proposalId = threadProposal.id;
      }

      if (!proposalId) {
        const errEmbed = createErrorEmbed(
          "Proposal ID Required",
          "Specify the `id` option or run this command inside the proposal's forum thread."
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const proposal = database.getProposal(proposalId);
      if (!proposal || proposal.guild_id !== guildId) {
        const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist in this server.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const isAuthor = proposal.user_id === interaction.user.id;
      const isAdmin = hasAdminPermission(interaction);

      if (!isAuthor && !isAdmin) {
        const errEmbed = createErrorEmbed(
          "Permission Denied",
          "Only the proposal author or server administrators can upload icons."
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const cached = await rebrandService.downloadAndCacheImage(icon.url, `proposal_${guildId}`);
        const updateData: any = {
          icon_url: icon.url,
          icon_path: cached.filePath,
          is_ready: 1,
        };
        if (name) updateData.name = name;
        if (topic !== null && topic !== undefined) updateData.topic = topic;

        const updated = database.updateProposalDetails(proposalId, updateData)!;
        const settings = database.getGuildSettings(guildId);

        if (proposal.thread_id) {
          const thread = (await interaction.guild.channels.fetch(proposal.thread_id).catch(() => null)) as ThreadChannel | null;
          if (thread && proposal.message_id) {
            const cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
            if (cardMsg) {
              const cardEmbed = createProposalEmbed(updated, settings.min_upvotes);
              const cardRow = createProposalActionRow(updated, settings.min_upvotes);
              await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
            }
          }
        }

        await rebrandService.checkAndNotifyAdminLogs(interaction.guild, proposal.id);

        const successEmbed = createSuccessEmbed(
          "🖼️ Server Icon Uploaded & Verified",
          `Server icon for Proposal **#${proposalId} ("${updated.name}")** updated successfully!`
        );
        successEmbed.setThumbnail(icon.url);

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (err: any) {
        console.error("[Admin] Icon upload error:", err);
        const errEmbed = createErrorEmbed("Upload Failed", err.message || "Failed to download and validate the image file.");
        await interaction.editReply({ embeds: [errEmbed] });
      }
      break;
    }

    case "status": {
      const settings = database.getGuildSettings(guildId);
      const active = settings.active_proposal_id ? database.getProposal(settings.active_proposal_id) : null;
      const nextProposal = database.getNextApprovedProposalInQueue(guildId);

      const statusEmbed = createStatusEmbed(settings, active, nextProposal, interaction.guild);
      await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
      break;
    }

    case "set-default": {
      const name = interaction.options.getString("name");
      const icon = interaction.options.getAttachment("icon");

      const updates: Record<string, any> = {};

      if (name) {
        updates.default_name = name;
      } else if (!database.getGuildSettings(guildId).default_name) {
        updates.default_name = interaction.guild.name;
      }

      if (icon) {
        updates.default_icon_url = icon.url;
        try {
          const cached = await rebrandService.downloadAndCacheImage(icon.url, `default_${guildId}`);
          updates.default_icon_path = cached.filePath;
        } catch (err) {
          console.error("[Admin] Error caching default icon:", err);
        }
      } else if (interaction.guild.iconURL()) {
        const currentIconUrl = interaction.guild.iconURL({ extension: "png", size: 512 });
        if (currentIconUrl) {
          updates.default_icon_url = currentIconUrl;
          try {
            const cached = await rebrandService.downloadAndCacheImage(currentIconUrl, `default_${guildId}`);
            updates.default_icon_path = cached.filePath;
          } catch (err) {
            console.error("[Admin] Error caching default icon:", err);
          }
        }
      }

      const updatedSettings = database.updateGuildSettings(guildId, updates);
      console.log(`[Admin] Default server name/icon configured for "${interaction.guild.name}":`, updates);

      const successEmbed = createSuccessEmbed(
        "✅ Default Baseline Saved",
        `Default Name: **${updatedSettings.default_name || interaction.guild.name}**\nDefault Icon: ${
          updatedSettings.default_icon_url ? `[View Saved Icon](${updatedSettings.default_icon_url})` : "*None*"
        }\n\nThis configuration will be restored every Monday at 00:00 UTC!`
      );

      if (updatedSettings.default_icon_url) {
        successEmbed.setThumbnail(updatedSettings.default_icon_url);
      }

      await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
      break;
    }

    case "approve": {
      let proposalId = interaction.options.getInteger("id");

      if (!proposalId && interaction.channel?.isThread()) {
        const threadProposal = database.getProposalByThreadId(interaction.channel.id);
        if (threadProposal) proposalId = threadProposal.id;
      }

      if (!proposalId) {
        const errEmbed = createErrorEmbed(
          "Proposal ID Required",
          "Specify the `id` option or run this command inside the proposal's forum thread."
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const proposal = database.getProposal(proposalId);
      if (!proposal || proposal.guild_id !== guildId) {
        const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist in this server.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const approved = database.approveProposal(proposalId, interaction.user.id);
      if (!approved) {
        const errEmbed = createErrorEmbed("Error", `Failed to approve proposal **#${proposalId}**.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const scheduledDateText = approved.scheduled_date ? formatWeekendDate(approved.scheduled_date) : "Next Available Weekend";
      console.log(`[Admin] Proposal #${approved.id} ("${approved.name}") approved by @${interaction.user.tag} for ${scheduledDateText}`);

      const successEmbed = createSuccessEmbed(
        "👑 Proposal Approved & Scheduled",
        `Proposal **#${approved.id} ("${approved.name}")** has been approved and scheduled for **${scheduledDateText}**!`
      );
      if (approved.icon_url) successEmbed.setThumbnail(approved.icon_url);

      const settings = database.getGuildSettings(guildId);
      if (approved.thread_id) {
        const thread = (await interaction.guild.channels.fetch(approved.thread_id).catch(() => null)) as ThreadChannel | null;
        if (thread) {
          // Remove rebrand tag and apply Approved tag (only 1 status tag active)
          await updateThreadStatusTag(thread, "approved", settings);

          if (approved.message_id) {
            const cardMsg = await thread.messages.fetch(approved.message_id).catch(() => null);
            if (cardMsg) {
              const cardEmbed = createProposalEmbed(approved, settings.min_upvotes);
              const cardRow = createProposalActionRow(approved, settings.min_upvotes);
              await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
            }
          }
          const threadNotice = createSuccessEmbed(
            "👑 Rebrand Approved by Admins!",
            `This proposal was approved by <@${interaction.user.id}> and is scheduled for **${scheduledDateText}**!`
          );
          await thread.send({ embeds: [threadNotice] }).catch(() => null);
        }
      }

      await interaction.reply({ embeds: [successEmbed] });
      break;
    }

    case "reject": {
      let proposalId = interaction.options.getInteger("id");
      const reason = interaction.options.getString("reason") || "Declined by server administrators";

      if (!proposalId && interaction.channel?.isThread()) {
        const threadProposal = database.getProposalByThreadId(interaction.channel.id);
        if (threadProposal) proposalId = threadProposal.id;
      }

      if (!proposalId) {
        const errEmbed = createErrorEmbed(
          "Proposal ID Required",
          "Specify the `id` option or run this command inside the proposal's forum thread."
        );
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const proposal = database.getProposal(proposalId);
      if (!proposal || proposal.guild_id !== guildId) {
        const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist in this server.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      const rejected = database.rejectProposal(proposalId, reason);
      console.log(`[Admin] Proposal #${proposalId} rejected by @${interaction.user.tag}. Reason: ${reason}`);

      const successEmbed = createErrorEmbed(
        "❌ Proposal Rejected",
        `Proposal **#${proposalId} ("${proposal.name}")** has been rejected.\nReason: *${reason}*`
      );

      const settings = database.getGuildSettings(guildId);
      if (rejected?.thread_id) {
        const thread = (await interaction.guild.channels.fetch(rejected.thread_id).catch(() => null)) as ThreadChannel | null;
        if (thread) {
          // Remove rebrand tag and apply Declined tag (only 1 status tag active)
          await updateThreadStatusTag(thread, "declined", settings);

          if (rejected.message_id) {
            const cardMsg = await thread.messages.fetch(rejected.message_id).catch(() => null);
            if (cardMsg) {
              const cardEmbed = createProposalEmbed(rejected, settings.min_upvotes);
              const cardRow = createProposalActionRow(rejected, settings.min_upvotes);
              await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
            }
          }
          const threadNotice = createErrorEmbed(
            "❌ Rebrand Rejected",
            `This proposal was rejected by <@${interaction.user.id}>.\nReason: *${reason}*`
          );
          await thread.send({ embeds: [threadNotice] }).catch(() => null);
        }
      }

      await interaction.reply({ embeds: [successEmbed] });
      break;
    }

    case "schedule": {
      const upcoming = database.getUpcomingSchedule(guildId);
      const scheduleEmbed = rebrandService.getScheduleEmbed(upcoming);
      await interaction.reply({ embeds: [scheduleEmbed] });
      break;
    }

    case "trigger": {
      const action = interaction.options.getString("action", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (action === "apply") {
        const result = await rebrandService.applyNextRebrand(interaction.guild);
        if (result.success) {
          const successEmbed = createSuccessEmbed("Rebrand Applied", result.message);
          await interaction.editReply({ embeds: [successEmbed] });
        } else {
          const errEmbed = createErrorEmbed("Trigger Failed", result.message);
          await interaction.editReply({ embeds: [errEmbed] });
        }
      } else {
        const result = await rebrandService.revertToDefault(interaction.guild);
        if (result.success) {
          const successEmbed = createSuccessEmbed("Reverted to Baseline", result.message);
          await interaction.editReply({ embeds: [successEmbed] });
        } else {
          const errEmbed = createErrorEmbed("Trigger Failed", result.message);
          await interaction.editReply({ embeds: [errEmbed] });
        }
      }
      break;
    }
  }
}

export function hasAdminPermission(
  interaction: ChatInputCommandInteraction | ButtonInteraction | any
): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user?.id) return true;

  const permissions = interaction.memberPermissions;
  if (!permissions) return false;

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}
