import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ForumChannel,
  ThreadChannel,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { database } from "../database";
import { rebrandService } from "../services/rebrandService";
import {
  createProposalEmbed,
  createProposalActionRow,
  createSuccessEmbed,
  createErrorEmbed,
} from "../services/announcement";

export const proposeCommand = new SlashCommandBuilder()
  .setName("propose")
  .setDescription("Submit a weekend rebrand proposal in the forum channel")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("The proposed server name")
      .setRequired(true)
      .setMaxLength(100)
  )
  .addAttachmentOption((option) =>
    option
      .setName("icon")
      .setDescription("The custom server icon image (PNG, JPG, WEBP, GIF)")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("topic")
      .setDescription("The theme or topic description for this rebrand")
      .setRequired(false)
      .setMaxLength(250)
  );

export async function handleProposeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed("Direct Message Not Supported", "This command can only be used inside a Discord server.");
    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString("name", true).trim();
  const iconAttachment = interaction.options.getAttachment("icon", true);
  const topic = interaction.options.getString("topic")?.trim() || null;

  const contentType = iconAttachment.contentType || "";
  const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(iconAttachment.name || "");
  if (!isImage) {
    const errorEmbed = createErrorEmbed(
      "Invalid File Type",
      "Please upload a valid image file (**PNG, JPG, WEBP, GIF**) for the server icon."
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const guildId = interaction.guild.id;
  const settings = database.getGuildSettings(guildId);

  await rebrandService.ensureDefaultBackup(interaction.guild);

  let iconPath: string | null = null;
  try {
    const cached = await rebrandService.downloadAndCacheImage(iconAttachment.url, `proposal_${guildId}`);
    iconPath = cached.filePath;
  } catch (err) {
    console.error("[Propose] Error caching proposal image:", err);
  }

  const isCurrentChannelThread = interaction.channel?.isThread();
  const threadId = isCurrentChannelThread ? interaction.channel.id : null;

  const proposal = database.createProposal({
    guildId,
    userId: interaction.user.id,
    name,
    topic,
    iconUrl: iconAttachment.url,
    iconPath,
    threadId,
    isReady: 1,
  });

  const proposalWithVotes = database.getProposal(proposal.id)!;
  const embed = createProposalEmbed(proposalWithVotes, settings.min_upvotes);
  const actionRow = createProposalActionRow(proposalWithVotes, settings.min_upvotes);

  try {
    let messageId: string = "";
    let channelId: string = interaction.channelId;
    let createdThreadId: string | null = threadId;
    let targetThread: ThreadChannel | null = null;

    if (isCurrentChannelThread) {
      const thread = interaction.channel as ThreadChannel;
      const msg = await thread.send({
        embeds: [embed],
        components: [actionRow],
      });
      messageId = msg.id;
      channelId = thread.id;
      createdThreadId = thread.id;
      targetThread = thread;

      await msg.pin().catch((err) => {
        console.error("[Propose] Failed to pin proposal card in current thread:", err);
      });
    } else {
      let targetChannel: any = null;
      if (settings.forum_channel_id) {
        targetChannel = await interaction.guild.channels.fetch(settings.forum_channel_id).catch(() => null);
      }

      if (!targetChannel && (interaction.channel as any)?.type === ChannelType.GuildForum) {
        targetChannel = interaction.channel;
      }

      if (targetChannel && targetChannel.type === ChannelType.GuildForum) {
        const forum = targetChannel as ForumChannel;
        const appliedTags = settings.rebrand_tag_id ? [settings.rebrand_tag_id] : [];
        const forumPost = await forum.threads.create({
          name: `[Rebrand] ${name}`,
          appliedTags,
          message: {
            embeds: [embed],
            components: [actionRow],
          },
        });

        createdThreadId = forumPost.id;
        channelId = forumPost.id;
        targetThread = forumPost;

        const starterMsg = await forumPost.fetchStarterMessage().catch(() => null);
        if (starterMsg) {
          messageId = starterMsg.id;
          await starterMsg.pin().catch((err) => {
            console.error("[Propose] Failed to pin proposal card in forum post:", err);
          });
        } else {
          messageId = forumPost.id;
        }
      } else {
        const errorEmbed = createErrorEmbed(
          "Forum Channel Not Configured",
          "Please configure the rebrand forum channel first with `/rebrand config`."
        );
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }
    }

    database.updateProposalMessage(proposal.id, messageId, channelId, createdThreadId);

    const threadMention = targetThread ? `<#${targetThread.id}>` : `<#${channelId}>`;
    const successEmbed = createSuccessEmbed(
      "🎨 Proposal Submitted!",
      `Your proposal **#${proposal.id} ("${name}")** is live and pinned in ${threadMention}!\n\nReact with ⬆️ on the post to upvote.`
    );
    if (iconAttachment.url) {
      successEmbed.setThumbnail(iconAttachment.url);
    }
    await interaction.editReply({ embeds: [successEmbed] });
  } catch (err) {
    console.error("[Propose] Error creating proposal thread/post:", err);
    const errorEmbed = createErrorEmbed(
      "Submission Incomplete",
      `Proposal was created (ID: #${proposal.id}), but failed to post in the forum. Please verify bot permissions.`
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
