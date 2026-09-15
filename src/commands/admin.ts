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
import {
  createStatusEmbed,
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
  createErrorEmbed,
  createInfoEmbed,
} from "../services/announcement";
import { formatWeekendDate } from "../utils/dateUtils";

export const rebrandAdminCommand = new SlashCommandBuilder()
  .setName("rebrand")
  .setDescription("Manage weekend rebrands, configuration, schedule, and overrides")
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("config")
      .setDescription("Configure forum channel, tags, admin logs, emojis, and voting thresholds")
      .addChannelOption((opt) =>
        opt
          .setName("forum_channel")
          .setDescription("The forum channel where rebrand threads are created (Forums only)")
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
    sub
      .setName("apply")
      .setDescription("Immediately apply a proposal to the server (Manual override)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Proposal ID to apply now").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("revert")
      .setDescription("Immediately revert server name and icon back to default baseline")
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel an approved or scheduled proposal")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Proposal ID to cancel").setRequired(true)
      )
  );

export function hasAdminPermission(interaction: ChatInputCommandInteraction | ButtonInteraction | any): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) return true;
  return false;
}

export async function handleRebrandAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed("Direct Message Not Supported", "This command can only be used inside a Discord server.");
    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (!hasAdminPermission(interaction)) {
    console.log(`[Admin] Permission denied for user @${interaction.user.tag} (${interaction.user.id}) in guild "${interaction.guild.name}"`);
    const errorEmbed = createErrorEmbed(
      "Permission Denied",
      "You need **Administrator** or **Manage Server** permission to use `/rebrand` admin commands."
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

        if (availableTags.length > 0) {
          database.updateGuildSettings(guildId, updates);

          const selectOptions = availableTags.slice(0, 25).map((t) => ({
            label: t.name,
            value: t.id,
            description: `Use tag "${t.name}" (ID: ${t.id})`,
            emoji: t.emoji?.name ? { name: t.emoji.name, id: t.emoji.id || undefined } : undefined,
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`rebrand_select_tag:${forumChan.id}`)
            .setPlaceholder("Select the tag that marks rebrand proposal threads")
            .addOptions(selectOptions);

          const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

          const configEmbed = new EmbedBuilder()
            .setTitle("🏷️ Select Rebrand Forum Tag")
            .setDescription(
              `Forum channel <#${forumChan.id}> has been set! Now select which tag identifies rebrand proposal threads:`
            )
            .setColor(0x5865f2);

          await interaction.reply({
            embeds: [configEmbed],
            components: [row],
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
            name: "📫 Forum Channel",
            value: settings.forum_channel_id ? `<#${settings.forum_channel_id}>` : "*Not set*",
            inline: true,
          },
          {
            name: "🏷️ Rebrand Tag ID",
            value: settings.rebrand_tag_id ? `\`${settings.rebrand_tag_id}\`` : "*Not set*",
            inline: true,
          },
          {
            name: "🎯 Required Upvotes",
            value: `**${settings.min_upvotes}**`,
            inline: true,
          },
          {
            name: "⬆️ Custom Upvote Emojis",
            value: settings.custom_upvote_emojis ? `\`${settings.custom_upvote_emojis}\`` : "*Default (⬆️, 👍, 🔺)*",
            inline: true,
          },
          {
            name: "⬇️ Custom Downvote Emojis",
            value: settings.custom_downvote_emojis ? `\`${settings.custom_downvote_emojis}\`` : "*Default (⬇️, 👎, 🔻)*",
            inline: true,
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [configEmbed], flags: MessageFlags.Ephemeral });
      break;
    }

    case "upload": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const attachment = interaction.options.getAttachment("icon", true);
      const specifiedId = interaction.options.getInteger("id");
      const name = interaction.options.getString("name");
      const topic = interaction.options.getString("topic");

      let proposal = specifiedId ? database.getProposal(specifiedId) : null;
      if (!proposal && interaction.channel?.isThread()) {
        proposal = database.getProposalByThreadId(interaction.channel.id);
      }

      if (!proposal) {
        const err = createErrorEmbed(
          "Proposal Not Found",
          "Could not determine which proposal to update. Please specify proposal `id` or run inside the proposal forum thread."
        );
        await interaction.editReply({ embeds: [err] });
        return;
      }

      let cached;
      try {
        cached = await rebrandService.downloadAndCacheImage(attachment.url, `proposal_${guildId}`);
      } catch (err: any) {
        const errEmbed = createErrorEmbed("Invalid Image File", err.message || "Failed to validate and save uploaded image.");
        await interaction.editReply({ embeds: [errEmbed] });
        return;
      }

      const updates: any = {
        icon_url: attachment.url,
        icon_path: cached.filePath,
        is_ready: 1,
      };
      if (name) updates.name = name;
      if (topic) updates.topic = topic;

      const updated = database.updateProposalDetails(proposal.id, updates)!;
      const settings = database.getGuildSettings(guildId);

      if (updated.thread_id && updated.message_id) {
        const thread = (await interaction.guild.channels.fetch(updated.thread_id).catch(() => null)) as ThreadChannel | null;
        if (thread) {
          const card = await thread.messages.fetch(updated.message_id).catch(() => null);
          if (card) {
            await card.edit({
              embeds: [createProposalEmbed(updated, settings.min_upvotes)],
              components: [createProposalActionRow(updated, settings.min_upvotes)],
            }).catch(() => null);
          }
        }
      }

      await rebrandService.checkAndNotifyAdminLogs(interaction.guild, updated.id);

      const success = createSuccessEmbed(
        "📸 Server Icon Uploaded Successfully",
        `Proposal **#${updated.id} ("${updated.name}")** updated with the uploaded server icon!`
      );
      success.setThumbnail(attachment.url);
      await interaction.editReply({ embeds: [success] });
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
          if (rejected.message_id) {
            const cardMsg = await thread.messages.fetch(rejected.message_id).catch(() => null);
            if (cardMsg) {
              const cardEmbed = createProposalEmbed(rejected, settings.min_upvotes);
              const cardRow = createProposalActionRow(rejected, settings.min_upvotes);
              await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
            }
          }
          const threadNotice = createErrorEmbed(
            "❌ Proposal Declined",
            `This rebrand proposal was declined by server administrators.\nReason: *${reason}*`
          );
          await thread.send({ embeds: [threadNotice] }).catch(() => null);
        }
      }

      await interaction.reply({ embeds: [successEmbed] });
      break;
    }

    case "apply": {
      const proposalId = interaction.options.getInteger("id", true);
      const proposal = database.getProposal(proposalId);

      if (!proposal || proposal.guild_id !== guildId) {
        const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply();
      console.log(`[Admin] Manually applying proposal #${proposal.id} ("${proposal.name}") in guild "${interaction.guild.name}"`);
      const success = await rebrandService.applyRebrand(interaction.guild, proposal, true);

      if (success) {
        const appliedEmbed = createSuccessEmbed(
          "🎉 Rebrand Applied Successfully!",
          `Server has been rebranded to **${proposal.name}**!\nTopic: ${proposal.topic || "*N/A*"}`
        );
        if (proposal.icon_url) appliedEmbed.setThumbnail(proposal.icon_url);
        await interaction.editReply({ embeds: [appliedEmbed] });
      } else {
        const errEmbed = createErrorEmbed(
          "Apply Failed",
          "Failed to apply the rebrand. Check bot permissions (Manage Server permission required)."
        );
        await interaction.editReply({ embeds: [errEmbed] });
      }
      break;
    }

    case "revert": {
      await interaction.deferReply();
      console.log(`[Admin] Manually reverting server name and icon to baseline for guild "${interaction.guild.name}"`);
      const success = await rebrandService.revertRebrand(interaction.guild, true);

      if (success) {
        const revertedEmbed = createSuccessEmbed(
          "✨ Server Reverted",
          "The server name and icon have been reverted back to their baseline defaults."
        );
        await interaction.editReply({ embeds: [revertedEmbed] });
      } else {
        const errEmbed = createErrorEmbed("Revert Failed", "Failed to revert server to defaults.");
        await interaction.editReply({ embeds: [errEmbed] });
      }
      break;
    }

    case "cancel": {
      const proposalId = interaction.options.getInteger("id", true);
      const proposal = database.getProposal(proposalId);

      if (!proposal || proposal.guild_id !== guildId) {
        const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist.`);
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      database.cancelProposal(proposalId);
      console.log(`[Admin] Cancelled proposal #${proposalId} in guild "${interaction.guild.name}"`);

      const cancelEmbed = createSuccessEmbed(
        "🚫 Proposal Cancelled",
        `Proposal **#${proposalId} ("${proposal.name}")** has been cancelled.`
      );
      await interaction.reply({ embeds: [cancelEmbed] });
      break;
    }
  }
}
