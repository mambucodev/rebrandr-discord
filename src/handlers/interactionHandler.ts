import type {
  Interaction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ThreadChannel,
  ForumChannel,
  MessageFlags,
  EmbedBuilder,
  TextChannel,
  Message,
} from "discord.js";
import { database } from "../database";
import { handleCommandInteraction } from "../commands";
import { hasAdminPermission } from "../commands/admin";
import { rebrandService } from "../services/rebrandService";
import { updateThreadStatusTag } from "./threadHandler";
import {
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
  createErrorEmbed,
  createInfoEmbed,
  createSuggestionEmbed,
  createSuggestionActionRow,
  createConfirmationActionRow,
  createForumTagConfigEmbedAndRows,
} from "../services/announcement";
import { formatWeekendDate } from "../utils/dateUtils";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      console.log(`[Interaction] Slash command /${interaction.commandName} by @${interaction.user.tag} in guild ${interaction.guild?.name || "DM"}`);
      await handleCommandInteraction(interaction);
    } else if (interaction.isButton()) {
      console.log(`[Interaction] Button "${interaction.customId}" clicked by @${interaction.user.tag} in guild ${interaction.guild?.name || "DM"}`);
      await handleButtonInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      console.log(`[Interaction] Modal "${interaction.customId}" submitted by @${interaction.user.tag} in guild ${interaction.guild?.name || "DM"}`);
      await handleModalSubmit(interaction);
    } else if (interaction.isStringSelectMenu()) {
      console.log(`[Interaction] Select menu "${interaction.customId}" selected by @${interaction.user.tag} in guild ${interaction.guild?.name || "DM"}`);
      await handleSelectMenuInteraction(interaction);
    }
  } catch (err) {
    console.error("[Interaction] Error processing interaction:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      const errorEmbed = createErrorEmbed(
        "Unexpected Error",
        "An unexpected error occurred while processing this interaction."
      );
      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
}

async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  // New multi-tag configuration menu (rebrand, approved, declined)
  if (interaction.customId.startsWith("rebrand_tag_select:")) {
    if (!hasAdminPermission(interaction)) {
      console.log(`[SelectMenu] Permission denied for @${interaction.user.tag} on tag selection`);
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can configure rebrand settings.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const [, type, forumId] = interaction.customId.split(":");
    const selectedVal = interaction.values[0]!;
    const newTagId = selectedVal === "clear" ? null : selectedVal;

    const updates: Record<string, any> = { forum_channel_id: forumId };
    if (type === "rebrand") updates.rebrand_tag_id = newTagId;
    if (type === "approved") updates.approved_tag_id = newTagId;
    if (type === "declined") updates.declined_tag_id = newTagId;

    const updatedSettings = database.updateGuildSettings(interaction.guildId!, updates);
    console.log(
      `[SelectMenu] Updated ${type} tag to ${newTagId || "None"} for forum ${forumId} in guild ${interaction.guildId}`
    );

    const forumChan = (await interaction.guild?.channels.fetch(forumId).catch(() => null)) as ForumChannel | null;
    if (forumChan && forumChan.availableTags) {
      const { embed, rows } = createForumTagConfigEmbedAndRows(forumChan, updatedSettings);
      await interaction.update({ embeds: [embed], components: rows });
    } else {
      const successEmbed = createSuccessEmbed(
        "Tag Updated",
        `Configured **${type} tag** to \`${newTagId || "None"}\` for forum <#${forumId}>.`
      );
      await interaction.update({ embeds: [successEmbed], components: [] });
    }
    return;
  }

  // Legacy single tag selector
  if (interaction.customId.startsWith("rebrand_select_tag:")) {
    if (!hasAdminPermission(interaction)) {
      console.log(`[SelectMenu] Permission denied for @${interaction.user.tag} on tag selection`);
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can configure rebrand settings.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const forumId = interaction.customId.split(":")[1]!;
    const selectedTagId = interaction.values[0]!;

    database.updateGuildSettings(interaction.guildId!, {
      forum_channel_id: forumId,
      rebrand_tag_id: selectedTagId,
    });
    console.log(`[SelectMenu] Configured forum channel ${forumId} with tag ID ${selectedTagId} for guild ${interaction.guildId}`);

    const successEmbed = new EmbedBuilder()
      .setTitle("🏷️ Rebrand Forum Tag Configured")
      .setDescription(
        `Forum channel <#${forumId}> and tag ID \`${selectedTagId}\` have been configured for weekend rebrands!\n\nAny thread created with (or tagged with) this tag will automatically receive a pinned rebrand proposal card.`
      )
      .setColor(0x57f287)
      .setTimestamp();

    await interaction.update({
      embeds: [successEmbed],
      components: [],
    });
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const [action, idStr] = interaction.customId.split(":");
  const id = parseInt(idStr ?? "", 10);

  // Upload Icon button — prompts file upload without typing a URL
  if (action === "rebrand_upload_icon") {
    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const isThreadAuthor = proposal.user_id === interaction.user.id;
    const isAdmin = hasAdminPermission(interaction);

    if (!isThreadAuthor && !isAdmin) {
      const errorEmbed = createErrorEmbed(
        "Author Only",
        "Only the proposal creator or administrators can upload the server icon."
      );
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.channel || !interaction.channel.isThread()) {
      const errorEmbed = createErrorEmbed("Thread Only", "This button can only be used inside the proposal thread.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const promptEmbed = new EmbedBuilder()
      .setTitle("📸 Upload Server Icon")
      .setDescription(
        `Please drop or upload your icon image file (**PNG, JPG, WEBP, or GIF**) into this thread within the next 2 minutes!\n\n*The bot will download, validate, and preview it on your proposal card automatically.*`
      )
      .setColor(0x5865f2)
      .setFooter({ text: "Max file size: 10MB • Direct file attachments only" });

    await interaction.reply({ embeds: [promptEmbed], flags: MessageFlags.Ephemeral });

    const thread = interaction.channel as ThreadChannel;
    const filter = (m: Message) => m.author.id === interaction.user.id && m.attachments.size > 0;

    try {
      const collected = await thread.awaitMessages({ filter, max: 1, time: 120_000, errors: ["time"] });
      const userMsg = collected.first();
      if (userMsg && userMsg.attachments.size > 0) {
        const attachment = userMsg.attachments.first()!;
        console.log(`[Upload] User @${interaction.user.tag} uploaded attachment "${attachment.name}" for proposal #${proposal.id}`);

        try {
          const cached = await rebrandService.downloadAndCacheImage(attachment.url, `proposal_${proposal.guild_id}`);
          const updated = database.updateProposalDetails(proposal.id, {
            icon_url: attachment.url,
            icon_path: cached.filePath,
            is_ready: 1,
          })!;

          const settings = database.getGuildSettings(interaction.guildId!);
          if (proposal.message_id) {
            const cardMsg = await thread.messages.fetch(proposal.message_id).catch(() => null);
            if (cardMsg) {
              const cardEmbed = createProposalEmbed(updated, settings.min_upvotes);
              const cardRow = createProposalActionRow(updated, settings.min_upvotes);
              await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
            }
          }

          if (interaction.guild) {
            await rebrandService.checkAndNotifyAdminLogs(interaction.guild, proposal.id);
          }

          const confirmedEmbed = createSuccessEmbed(
            "✅ Server Icon Uploaded & Verified",
            `Server icon for Proposal **#${proposal.id} ("${proposal.name}")** updated successfully!`
          );
          confirmedEmbed.setThumbnail(attachment.url);
          await userMsg.reply({ embeds: [confirmedEmbed] }).catch(() => null);
        } catch (downloadErr: any) {
          console.error("[Upload] Error downloading/validating image:", downloadErr);
          const failEmbed = createErrorEmbed(
            "Invalid Image File",
            downloadErr.message || "Failed to process image. Please upload a valid PNG, JPG, WEBP, or GIF under 10MB."
          );
          await userMsg.reply({ embeds: [failEmbed] }).catch(() => null);
        }
      }
    } catch (collectorErr) {
      console.log(`[Upload] Message collector timed out or stopped for proposal #${proposal.id}`);
    }
    return;
  }

  // Edit Name & Topic Modal (pure text modal, no URL input)
  if (action === "rebrand_open_modal") {
    const proposal = database.getProposal(id);
    if (!proposal) {
      console.log(`[Button] Proposal #${id} not found for modal open request`);
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    console.log(`[Button] Opening detail modal for proposal #${proposal.id} to user @${interaction.user.tag}`);

    const modal = new ModalBuilder()
      .setCustomId(`rebrand_modal_submit:${proposal.id}`)
      .setTitle(`Edit Proposal #${proposal.id}`);

    const nameInput = new TextInputBuilder()
      .setCustomId("rebrand_name")
      .setLabel("Proposed Server Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Cyberpunk Weekend")
      .setMaxLength(100)
      .setRequired(true)
      .setValue(proposal.name && proposal.name !== "Pending Rebrand" ? proposal.name : "");

    const topicInput = new TextInputBuilder()
      .setCustomId("rebrand_topic")
      .setLabel("Theme / Topic Vision")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Explain your theme, vibes, or plans for this weekend...")
      .setMaxLength(250)
      .setRequired(false)
      .setValue(proposal.topic || "");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(topicInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // Community Suggest Asset Modal
  if (action === "rebrand_suggest_modal") {
    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`rebrand_suggest_submit:${proposal.id}`)
      .setTitle(`Suggest Assets for #${proposal.id}`);

    const nameInput = new TextInputBuilder()
      .setCustomId("suggest_name")
      .setLabel("Suggested Server Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Retro Wave Server")
      .setMaxLength(100)
      .setRequired(true);

    const topicInput = new TextInputBuilder()
      .setCustomId("suggest_topic")
      .setLabel("Suggested Theme / Topic")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Explain your theme suggestion...")
      .setMaxLength(250)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(topicInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (action === "rebrand_accept_suggest" || action === "rebrand_reject_suggest") {
    const suggestion = database.getSuggestion(id);
    if (!suggestion) {
      console.log(`[Button] Suggestion #${id} not found`);
      const errorEmbed = createErrorEmbed("Suggestion Not Found", "This suggestion no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const proposal = database.getProposal(suggestion.proposal_id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "The associated proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const isThreadAuthor = proposal.user_id === interaction.user.id;
    const isAdmin = hasAdminPermission(interaction);

    if (!isThreadAuthor && !isAdmin) {
      console.log(`[Button] User @${interaction.user.tag} denied permission to accept/reject suggestion #${suggestion.id}`);
      const errorEmbed = createErrorEmbed(
        "Permission Denied",
        "Only the thread author or administrators can accept or decline asset suggestions."
      );
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === "rebrand_accept_suggest") {
      console.log(`[Button] Suggestion #${suggestion.id} ACCEPTED by @${interaction.user.tag} for proposal #${proposal.id}`);
      database.updateSuggestionStatus(suggestion.id, "accepted");

      let iconPath: string | null = null;
      if (suggestion.icon_url) {
        try {
          const cached = await rebrandService.downloadAndCacheImage(suggestion.icon_url, `proposal_${proposal.guild_id}`);
          iconPath = cached.filePath;
        } catch (err) {
          console.error("[Suggestion] Error caching icon:", err);
        }
      }

      const updated = database.updateProposalDetails(proposal.id, {
        name: suggestion.name,
        icon_url: suggestion.icon_url,
        icon_path: iconPath,
        topic: suggestion.topic,
        is_ready: 1,
      })!;

      const settings = database.getGuildSettings(interaction.guildId!);
      if (proposal.thread_id && proposal.message_id && interaction.channel?.isThread()) {
        const cardMsg = await interaction.channel.messages.fetch(proposal.message_id).catch(() => null);
        if (cardMsg) {
          const cardEmbed = createProposalEmbed(updated, settings.min_upvotes);
          const cardRow = createProposalActionRow(updated, settings.min_upvotes);
          await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
        }
      }

      if (interaction.guild) {
        await rebrandService.checkAndNotifyAdminLogs(interaction.guild, proposal.id);
      }

      const acceptedEmbed = createSuccessEmbed(
        "✅ Suggestion Accepted",
        `Asset suggestion by <@${suggestion.user_id}> accepted by <@${interaction.user.id}>! Proposal #${proposal.id} updated.`
      );
      await interaction.update({ embeds: [acceptedEmbed], components: [] });
    } else {
      console.log(`[Button] Suggestion #${suggestion.id} DECLINED by @${interaction.user.tag}`);
      database.updateSuggestionStatus(suggestion.id, "rejected");
      const rejectedEmbed = createErrorEmbed(
        "❌ Suggestion Declined",
        `Asset suggestion declined by <@${interaction.user.id}>.`
      );
      await interaction.update({ embeds: [rejectedEmbed], components: [] });
    }
    return;
  }

  if (action === "rebrand_log_approve") {
    if (!hasAdminPermission(interaction)) {
      console.log(`[Button] Admin approve button clicked by unauthorized user @${interaction.user.tag}`);
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can approve rebrands.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const confirmRow = createConfirmationActionRow("approve", proposal.id);
    const confirmEmbed = new EmbedBuilder()
      .setTitle("⚠️ Confirm Approval")
      .setDescription(
        `Are you sure you want to approve proposal **#${proposal.id} ("${proposal.name}")**?\n\nThis will schedule it for the next available weekend rebrand slot.`
      )
      .setColor(0xf1c40f);

    await interaction.reply({
      embeds: [confirmEmbed],
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "rebrand_log_reject") {
    if (!hasAdminPermission(interaction)) {
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can reject rebrands.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const confirmRow = createConfirmationActionRow("reject", proposal.id);
    const confirmEmbed = new EmbedBuilder()
      .setTitle("⚠️ Confirm Rejection")
      .setDescription(`Are you sure you want to reject proposal **#${proposal.id} ("${proposal.name}")**?`)
      .setColor(0xed4245);

    await interaction.reply({
      embeds: [confirmEmbed],
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "rebrand_cancel_action") {
    const cancelEmbed = createInfoEmbed("Action Cancelled", "The approval/rejection action was cancelled.");
    await interaction.update({ embeds: [cancelEmbed], components: [] });
    return;
  }

  if (action === "rebrand_confirm_approve") {
    if (!hasAdminPermission(interaction)) {
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can approve rebrands.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const approved = database.approveProposal(id, interaction.user.id);
    if (!approved || !interaction.guild) {
      const errorEmbed = createErrorEmbed("Approval Failed", "Failed to approve proposal.");
      await interaction.update({ embeds: [errorEmbed], components: [] });
      return;
    }

    const settings = database.getGuildSettings(interaction.guild.id);
    const scheduledDateText = approved.scheduled_date ? formatWeekendDate(approved.scheduled_date) : "Next Available Weekend";
    console.log(`[Admin] Proposal #${approved.id} ("${approved.name}") approved by @${interaction.user.tag} for ${scheduledDateText}`);

    if (approved.thread_id) {
      const thread = (await interaction.guild.channels.fetch(approved.thread_id).catch(() => null)) as ThreadChannel | null;
      if (thread) {
        // Automatically swap tags: remove rebrand tag, apply Approved tag (only 1 status tag assigned)
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
          `This rebrand proposal was approved by <@${interaction.user.id}> and is scheduled for **${scheduledDateText}**!`
        );
        await thread.send({ embeds: [threadNotice] }).catch(() => null);
      }
    }

    if (approved.log_message_id && settings.logs_channel_id) {
      const logsChan = (await interaction.guild.channels.fetch(settings.logs_channel_id).catch(() => null)) as TextChannel | null;
      if (logsChan) {
        const logMsg = await logsChan.messages.fetch(approved.log_message_id).catch(() => null);
        if (logMsg) {
          const updatedLogEmbed = new EmbedBuilder()
            .setTitle(`✅ Rebrand Approved — #${approved.id} ("${approved.name}")`)
            .setDescription(`Approved by <@${interaction.user.id}>\nScheduled for **${scheduledDateText}**`)
            .setColor(0x57f287)
            .setTimestamp();
          await logMsg.edit({ embeds: [updatedLogEmbed], components: [] }).catch(() => null);
        }
      }
    }

    const successEmbed = createSuccessEmbed(
      "✅ Approved & Scheduled",
      `Proposal **#${approved.id} ("${approved.name}")** approved and scheduled for **${scheduledDateText}**.`
    );
    await interaction.update({ embeds: [successEmbed], components: [] });
    return;
  }

  if (action === "rebrand_confirm_reject") {
    if (!hasAdminPermission(interaction)) {
      const errorEmbed = createErrorEmbed("Permission Denied", "Only administrators can reject rebrands.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const rejected = database.rejectProposal(id, `Rejected by <@${interaction.user.id}> in Admin Logs`);
    if (!rejected || !interaction.guild) {
      const errorEmbed = createErrorEmbed("Rejection Failed", "Failed to reject proposal.");
      await interaction.update({ embeds: [errorEmbed], components: [] });
      return;
    }

    console.log(`[Admin] Proposal #${id} rejected by @${interaction.user.tag}`);
    const settings = database.getGuildSettings(interaction.guild.id);

    if (rejected.thread_id) {
      const thread = (await interaction.guild.channels.fetch(rejected.thread_id).catch(() => null)) as ThreadChannel | null;
      if (thread) {
        // Automatically swap tags: remove rebrand tag, apply Declined tag (only 1 status tag assigned)
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
          `This proposal was rejected by <@${interaction.user.id}>.`
        );
        await thread.send({ embeds: [threadNotice] }).catch(() => null);
      }
    }

    if (rejected.log_message_id && settings.logs_channel_id) {
      const logsChan = (await interaction.guild.channels.fetch(settings.logs_channel_id).catch(() => null)) as TextChannel | null;
      if (logsChan) {
        const logMsg = await logsChan.messages.fetch(rejected.log_message_id).catch(() => null);
        if (logMsg) {
          const updatedLogEmbed = new EmbedBuilder()
            .setTitle(`❌ Rebrand Rejected — #${rejected.id}`)
            .setDescription(`Rejected by <@${interaction.user.id}>.`)
            .setColor(0xed4245)
            .setTimestamp();
          await logMsg.edit({ embeds: [updatedLogEmbed], components: [] }).catch(() => null);
        }
      }
    }

    const successEmbed = createSuccessEmbed(
      "❌ Proposal Rejected",
      `Proposal **#${rejected.id} ("${rejected.name}")** has been marked as rejected.`
    );
    await interaction.update({ embeds: [successEmbed], components: [] });
    return;
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [action, idStr] = interaction.customId.split(":");
  const id = parseInt(idStr ?? "", 10);

  if (action === "rebrand_modal_submit") {
    const name = interaction.fields.getTextInputValue("rebrand_name");
    const topic = interaction.fields.getTextInputValue("rebrand_topic");

    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const isAuthor = proposal.user_id === interaction.user.id;
    const isAdmin = hasAdminPermission(interaction);

    if (!isAuthor && !isAdmin) {
      const errorEmbed = createErrorEmbed("Permission Denied", "Only the creator or administrators can edit details.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const updated = database.updateProposalDetails(id, {
      name,
      topic: topic || null,
    })!;

    console.log(`[Modal] Updated proposal #${id} details: Name="${name}", Topic="${topic}"`);

    const settings = database.getGuildSettings(interaction.guildId!);
    if (proposal.thread_id && proposal.message_id && interaction.channel?.isThread()) {
      const cardMsg = await interaction.channel.messages.fetch(proposal.message_id).catch(() => null);
      if (cardMsg) {
        const cardEmbed = createProposalEmbed(updated, settings.min_upvotes);
        const cardRow = createProposalActionRow(updated, settings.min_upvotes);
        await cardMsg.edit({ embeds: [cardEmbed], components: [cardRow] }).catch(() => null);
      }
    }

    if (interaction.guild) {
      await rebrandService.checkAndNotifyAdminLogs(interaction.guild, proposal.id);
    }

    const successEmbed = createSuccessEmbed("Details Updated", `Updated proposal name to **"${name}"**!`);
    await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "rebrand_suggest_submit") {
    const name = interaction.fields.getTextInputValue("suggest_name");
    const topic = interaction.fields.getTextInputValue("suggest_topic");

    const proposal = database.getProposal(id);
    if (!proposal) {
      const errorEmbed = createErrorEmbed("Proposal Not Found", "This proposal no longer exists.");
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const suggestion = database.createSuggestion({
      proposalId: proposal.id,
      userId: interaction.user.id,
      name,
      iconUrl: "",
      topic: topic || null,
    });

    console.log(`[Suggestion] Created asset suggestion #${suggestion.id} by @${interaction.user.tag} for proposal #${proposal.id}`);

    if (proposal.thread_id && interaction.channel?.isThread()) {
      const suggestEmbed = createSuggestionEmbed(suggestion, proposal);
      const suggestRow = createSuggestionActionRow(suggestion.id);
      await interaction.channel.send({
        content: `<@${proposal.user_id}> A new asset suggestion was submitted by <@${interaction.user.id}>!`,
        embeds: [suggestEmbed],
        components: [suggestRow],
      });
    }

    const successEmbed = createSuccessEmbed(
      "Suggestion Submitted",
      `Your asset suggestion for proposal **#${proposal.id}** has been posted to the thread for the author to review!`
    );
    await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
    return;
  }
}
