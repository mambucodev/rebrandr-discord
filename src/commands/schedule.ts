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
  toContainerPayload,
} from "../services/announcement";

export const scheduleCommand = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("View the schedule of upcoming and active weekend rebrands");

export async function handleScheduleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed("Direct Message Not Supported", "This command can only be used inside a Discord server.");
    await interaction.reply(toContainerPayload(errorEmbed, [], { ephemeral: true }));
    return;
  }

  const schedule = database.getUpcomingSchedule(interaction.guild.id);
  const embed = createScheduleEmbed(schedule, interaction.guild);

  await interaction.reply(toContainerPayload(embed));
}

export { proposalsCommand, handleProposalsCommand } from "./proposals";

