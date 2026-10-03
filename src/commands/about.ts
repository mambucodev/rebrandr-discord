import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { database } from "../database";
import { toContainerPayload } from "../services/announcement";
import { getVersionInfo } from "../utils/version";

export const aboutCommand = new SlashCommandBuilder()
  .setName("about")
  .setDescription("View bot statistics, deployment info, and public repository link");

export async function handleAboutCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const versionInfo = getVersionInfo();
  const stats = database.getStats();

  const totalGuilds = interaction.client.guilds?.cache?.size || 0;
  let totalMembers = 0;
  if (interaction.client.guilds?.cache) {
    for (const guild of interaction.client.guilds.cache.values()) {
      totalMembers += (guild as any).memberCount || 0;
    }
  }

  const uptimeMs = interaction.client.uptime || process.uptime() * 1000;
  const startTimestamp = Math.floor((Date.now() - uptimeMs) / 1000);

  const commitDisplay =
    versionInfo.commitUrl
      ? `[\`${versionInfo.shortCommitHash}\`](${versionInfo.commitUrl})`
      : `\`${versionInfo.shortCommitHash}\``;

  const embed = new EmbedBuilder()
    .setTitle("🎨 Weekend Rebrand — About & Statistics")
    .setDescription(
      "Automated Discord bot for community-driven weekend server rebrands (**UTC+0**). Members propose and vote on server names, icons, and themes during the week, transforming the server every weekend!"
    )
    .setColor(0x5865f2)
    .addFields(
      {
        name: "📊 Community Activity",
        value: [
          `• Total Proposals: **${stats.totalProposals}**`,
          `• 🏆 Completed Rebrands: **${stats.completedProposals}**`,
          `• 🗓️ Approved & Scheduled: **${stats.approvedProposals}**`,
          `• 🗳️ Total Votes Cast: **${stats.totalVotes}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "🌐 Bot Reach",
        value: [
          `• Connected Servers: **${totalGuilds}**`,
          `• Community Members: **~${totalMembers.toLocaleString()}**`,
          `• Active Configured: **${stats.configuredGuilds}**`,
          `• Pending Proposals: **${stats.pendingProposals}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "⚡ System & Runtime",
        value: [
          `• Runtime: **Bun v${Bun.version}**`,
          `• Discord Library: **discord.js v14**`,
          `• Bot Started: <t:${startTimestamp}:R>`,
          `• License: **MIT**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🚀 Deployment & Source",
        value: [
          `• Bot Version: **v${versionInfo.version}**`,
          `• Deployed Commit: ${commitDisplay}`,
          `• Public Repository: [mambucodev/rebrandr-discord](${versionInfo.repoUrl})`,
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({
      text: "Weekend Rebrand • Open Source Community Bot",
    })
    .setTimestamp();

  if (interaction.client.user?.displayAvatarURL()) {
    embed.setThumbnail(interaction.client.user.displayAvatarURL());
  }

  const buttons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Public Repository")
      .setURL(versionInfo.repoUrl)
      .setEmoji("🐙"),
  ];

  if (versionInfo.commitUrl) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(`Commit ${versionInfo.shortCommitHash}`)
        .setURL(versionInfo.commitUrl)
        .setEmoji("🔨")
    );
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

  await interaction.reply(toContainerPayload(embed, [actionRow]));
}
