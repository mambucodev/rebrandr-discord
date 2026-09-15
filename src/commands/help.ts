import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { database } from "../database";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Learn how Weekend Rebrand works and view available commands");

export async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guild?.id;
  const settings = guildId ? database.getGuildSettings(guildId) : null;
  const minVotes = settings ? settings.min_upvotes : 4;

  const embed = new EmbedBuilder()
    .setTitle("🎨 Weekend Rebrand — Guide & Commands")
    .setDescription(
      "Every weekend (**Saturday 00:00 UTC to Monday 00:00 UTC**), the server transforms with a community-chosen custom name, icon, and theme! When the weekend concludes, everything automatically reverts back to default."
    )
    .setColor(0x5865f2)
    .addFields(
      {
        name: "🏷️ How Proposals Work",
        value: [
          "1. **Create a Forum Post**: Create a new post in the rebrand forum channel and apply the rebrand tag.",
          "2. **Auto-Pinned Proposal Card**: The bot automatically pins an expressive proposal card in your thread.",
          "3. **Upload Icon & Edit Details**: Click **📸 Upload Icon** (or attach an image file directly in the thread / starter post) to set your server icon! Click **📝 Edit Details** to change the proposed name and theme description.",
          `4. **Community Voting**: Members vote by reacting with **⬆️ (Upvote)** or **⬇️ (Downvote)** directly on the thread post itself (requires ${minVotes} net upvotes). Custom server emojis are also supported if configured. Reactions on the bot's card are ignored.`,
        ].join("\n"),
      },
      {
        name: "👥 Member Commands",
        value: [
          "• `/propose <name> <icon> [topic]` — Directly submit a proposal with an uploaded icon file and create a tagged forum post.",
          "• `/schedule` — View upcoming approved and active weekend rebrands.",
          "• `/proposals` — List pending community proposals.",
          "• `/help` — View this guide.",
        ].join("\n"),
      },
      {
        name: "🛡️ Admin Commands (Manage Server)",
        value: [
          "• `/rebrand config [forum_channel] [logs_channel] [min_upvotes] [upvote_emojis] [downvote_emojis]` — Configure channels, voting goal, and custom server emojis.",
          "• `/rebrand upload <icon> [id] [name] [topic]` — Directly upload and validate a custom server icon image.",
          "• `/rebrand approve [id]` — Approve and schedule a proposal.",
          "• `/rebrand reject [id] [reason]` — Reject a proposal.",
          "• `/rebrand status` — View configuration and queue status.",
          "• `/rebrand set-default [name] [icon]` — Save baseline server name and icon.",
          "• `/rebrand apply <id>` — Manually apply a rebrand right now.",
          "• `/rebrand revert` — Manually revert back to baseline.",
          "• `/rebrand cancel <id>` — Cancel an approved or scheduled proposal.",
        ].join("\n"),
      }
    )
    .setFooter({
      text: "Weekend Rebrand • All times in UTC",
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
