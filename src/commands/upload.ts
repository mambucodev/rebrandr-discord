import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  MessageFlags,
  ThreadChannel,
} from "discord.js";
import { database } from "../database";
import { rebrandService } from "../services/rebrandService";
import {
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
  createErrorEmbed,
  hasAdminPermission,
  toContainerPayload,
} from "../services/announcement";

export const uploadCommand = new SlashCommandBuilder()
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
  );

export async function handleUploadCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed(
      "Direct Message Not Supported",
      "This command can only be used inside a Discord server."
    );
    await interaction.reply(toContainerPayload(errorEmbed, [], { ephemeral: true }));
    return;
  }

  const guildId = interaction.guild.id;
  const icon = interaction.options.getAttachment("icon", true);
  let proposalId = interaction.options.getInteger("id");
  const name = interaction.options.getString("name");
  const topic = interaction.options.getString("topic");

  console.log(`[Upload] Command "/upload" invoked by @${interaction.user.tag} in guild "${interaction.guild.name}" (${guildId})`);

  const contentType = icon.contentType || "";
  const isImage =
    contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(icon.name || "");
  if (!isImage) {
    const errEmbed = createErrorEmbed(
      "Invalid Image File",
      "Please upload a valid image file (**PNG, JPG, WEBP, or GIF**) for the server icon."
    );
    await interaction.reply(toContainerPayload(errEmbed, [], { ephemeral: true }));
    return;
  }

  if (!proposalId && interaction.channel?.isThread()) {
    const threadProposal = database.getProposalByThreadId(interaction.channel.id);
    if (threadProposal) proposalId = threadProposal.id;
  }

  if (!proposalId) {
    const errEmbed = createErrorEmbed(
      "Proposal ID Required",
      "Specify the `id` option (e.g. `/upload icon:<file> id:123`) or run this command directly inside the proposal's forum thread."
    );
    await interaction.reply(toContainerPayload(errEmbed, [], { ephemeral: true }));
    return;
  }

  const proposal = database.getProposal(proposalId);
  if (!proposal || proposal.guild_id !== guildId) {
    const errEmbed = createErrorEmbed("Not Found", `Proposal **#${proposalId}** does not exist in this server.`);
    await interaction.reply(toContainerPayload(errEmbed, [], { ephemeral: true }));
    return;
  }

  const isThreadOwner =
    interaction.channel?.isThread() &&
    (interaction.channel as ThreadChannel).ownerId === interaction.user.id;
  const isAuthor = proposal.user_id === interaction.user.id || Boolean(isThreadOwner);
  const isAdmin = hasAdminPermission(interaction);

  if (!isAuthor && !isAdmin) {
    const errEmbed = createErrorEmbed(
      "Permission Denied",
      "Only the proposal author or server administrators can upload icons for this proposal. If you'd like to suggest an icon, please use the **Suggest Asset** button in the thread!"
    );
    await interaction.reply(toContainerPayload(errEmbed, [], { ephemeral: true }));
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
          await cardMsg.edit(toContainerPayload(cardEmbed, [cardRow])).catch(() => null);
        }
      }
    }

    await rebrandService.checkAndNotifyAdminLogs(interaction.guild, proposal.id);

    const successEmbed = createSuccessEmbed(
      "🖼️ Server Icon Uploaded & Verified",
      `Server icon for Proposal **#${proposalId} ("${updated.name}")** updated successfully!`
    );
    successEmbed.setThumbnail(icon.url);

    await interaction.editReply(toContainerPayload(successEmbed));
  } catch (err: any) {
    console.error("[Upload] Icon upload error:", err);
    const errEmbed = createErrorEmbed("Upload Failed", err.message || "Failed to download and validate the image file.");
    await interaction.editReply(toContainerPayload(errEmbed));
  }
}
