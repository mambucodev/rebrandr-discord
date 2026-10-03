import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { database } from "../database";
import {
  createProposalsListEmbed,
  createProposalCarouselEmbed,
  createProposalCarouselActionRows,
  categorizeAndSortProposals,
  createErrorEmbed,
  toContainerPayload,
} from "../services/announcement";

export const proposalsCommand = new SlashCommandBuilder()
  .setName("proposals")
  .setDescription("View, browse, and manage pending community rebrand proposals")
  .addSubcommand((sub) =>
    sub
      .setName("browse")
      .setDescription("Interactively browse proposals one at a time with navigation and admin actions")
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List all pending proposals categorized by readiness (ready, missing assets, in progress)")
  );

export async function handleProposalsList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed(
      "Direct Message Not Supported",
      "This command can only be used inside a Discord server."
    );
    await interaction.reply(toContainerPayload(errorEmbed, [], { ephemeral: true }));
    return;
  }

  const settings = database.getGuildSettings(interaction.guild.id);
  const pending = database.getProposalsByStatus(interaction.guild.id, "pending");
  const embed = createProposalsListEmbed(pending, interaction.guild, settings.min_upvotes);

  await interaction.reply(toContainerPayload(embed));
}

export async function handleProposalsBrowse(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed(
      "Direct Message Not Supported",
      "This command can only be used inside a Discord server."
    );
    await interaction.reply(toContainerPayload(errorEmbed, [], { ephemeral: true }));
    return;
  }

  const settings = database.getGuildSettings(interaction.guild.id);
  const pending = database.getProposalsByStatus(interaction.guild.id, "pending");

  if (pending.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setAuthor({ name: "COMMUNITY PROPOSALS BROWSER" })
      .setTitle(`🗳️ Proposals Queue — ${interaction.guild.name}`)
      .setDescription(
        "There are no pending proposals right now!\n\nPost your rebrand idea in the server's rebrand forum to get started."
      )
      .setColor(0x5865f2)
      .setTimestamp();
    await interaction.reply(toContainerPayload(emptyEmbed));
    return;
  }

  const { allSorted } = categorizeAndSortProposals(pending, settings.min_upvotes);
  const initialIndex = 0;
  const proposal = allSorted[initialIndex]!;

  const embed = createProposalCarouselEmbed(
    proposal,
    settings.min_upvotes,
    initialIndex,
    allSorted.length,
    interaction.guild
  );
  const rows = createProposalCarouselActionRows(
    proposal,
    initialIndex,
    allSorted.length,
    interaction.guild.id
  );

  await interaction.reply(toContainerPayload(embed, rows));
}

export async function handleProposalsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    const errorEmbed = createErrorEmbed(
      "Direct Message Not Supported",
      "This command can only be used inside a Discord server."
    );
    await interaction.reply(toContainerPayload(errorEmbed, [], { ephemeral: true }));
    return;
  }

  const sub = interaction.options.getSubcommand(false) || "browse";
  if (sub === "list") {
    await handleProposalsList(interaction);
  } else {
    await handleProposalsBrowse(interaction);
  }
}
