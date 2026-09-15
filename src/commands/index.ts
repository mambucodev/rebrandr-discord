import {
  REST,
  Routes,
  Client,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config";
import { proposeCommand, handleProposeCommand } from "./propose";
import { scheduleCommand, proposalsCommand, handleScheduleCommand, handleProposalsCommand } from "./schedule";
import { rebrandAdminCommand, handleRebrandAdminCommand } from "./admin";
import { helpCommand, handleHelpCommand } from "./help";

export const commands = [
  proposeCommand,
  scheduleCommand,
  proposalsCommand,
  rebrandAdminCommand,
  helpCommand,
];

export async function registerCommands(
  client: Client,
  token?: string,
  guildId?: string
): Promise<void> {
  if (!client.user) {
    console.error("[Commands] Client user is not available for registration.");
    return;
  }

  const authToken = token || client.token || config.token;
  if (!authToken) {
    console.error("[Commands] Error registering commands: No bot token was provided or found in client configuration.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(authToken);
  const commandData = commands.map((cmd) => cmd.toJSON());

  try {
    if (guildId) {
      console.log(`[Commands] Registering ${commandData.length} slash commands to guild ${guildId} (Instant)...`);
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
        body: commandData,
      });
      console.log(`[Commands] Successfully registered commands to guild ${guildId}!`);
    } else {
      console.log(`[Commands] Registering ${commandData.length} global slash commands...`);
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commandData,
      });
      console.log("[Commands] Successfully registered application commands globally!");

      // Clear any guild-specific commands so they don't duplicate global commands in Discord's menu
      for (const [gId, guild] of client.guilds.cache) {
        try {
          await rest.put(Routes.applicationGuildCommands(client.user.id, gId), {
            body: [],
          });
          console.log(`[Commands] Cleaned up duplicate guild-level commands for "${guild.name}" (${gId})`);
        } catch (gErr) {
          // Ignored if permissions don't allow or already clear
        }
      }
    }
  } catch (err) {
    console.error("[Commands] Error registering commands:", err);
  }
}

export async function handleCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case "help":
      await handleHelpCommand(interaction);
      break;
    case "propose":
      await handleProposeCommand(interaction);
      break;
    case "schedule":
      await handleScheduleCommand(interaction);
      break;
    case "proposals":
      await handleProposalsCommand(interaction);
      break;
    case "rebrand":
      await handleRebrandAdminCommand(interaction);
      break;
    default:
      console.warn(`[Commands] Unknown command: /${interaction.commandName}`);
  }
}
