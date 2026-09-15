import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { database } from "../database";
import {
  createScheduleEmbed,
  createProposalsListEmbed,
  createErrorEmbed,
} from "../services/announcement";

export const scheduleCommand = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("View the schedule of upcoming and active weekend rebrands");

export const proposalsCommand = new SlashCommandBuilder()
  .setName("proposals")
  .setDescription("List all currently pending rebrand proposals");

export async function handleScheduleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed("Direct Message Not Supported", "This command can only be used inside a Discord server.");
    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  const schedule = database.getUpcomingSchedule(interaction.guild.id);
  const embed = createScheduleEmbed(schedule, interaction.guild);

  await interaction.reply({ embeds: [embed] });
}

export async function handleProposalsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed("Direct Message Not Supported", "This command can only be used inside a Discord server.");
    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = database.getGuildSettings(interaction.guild.id);
  const pending = database.getProposalsByStatus(interaction.guild.id, "pending");
  const embed = createProposalsListEmbed(pending, interaction.guild, settings.min_upvotes);

  await interaction.reply({ embeds: [embed] });
}
