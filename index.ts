import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { config } from "./src/config";
import { registerCommands } from "./src/commands";
import { handleInteraction } from "./src/handlers/interactionHandler";
import {
  handleThreadCreate,
  handleThreadUpdate,
  handleReactionEvent,
  handleThreadMessage,
} from "./src/handlers/threadHandler";
import { scheduler } from "./src/services/scheduler";
import { recoveryService } from "./src/services/recoveryService";
import { startHealthServer, stopHealthServer } from "./src/services/healthServer";
import { database } from "./src/database";

if (!config.token) {
  console.error("❌ ERROR: DISCORD_TOKEN is not set in environment variables (.env)");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Reaction,
    Partials.Channel,
    Partials.ThreadMember,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Bot] Successfully authenticated as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
  console.log(`[Bot] Connected to ${readyClient.guilds.cache.size} Discord server(s)`);

  for (const [, guild] of readyClient.guilds.cache) {
    console.log(`  • Guild: "${guild.name}" (ID: ${guild.id}) - Members: ${guild.memberCount}`);
  }

  // Start internal HTTP health server for Docker and Coolify container monitoring
  startHealthServer(readyClient);

  try {
    console.log("[Bot] Registering slash commands globally and to active guilds...");
    await registerCommands(readyClient, config.token);
    console.log("[Bot] Slash commands successfully synchronized.");
  } catch (err) {
    console.error("[Bot] Failed to register slash commands:", err);
  }

  // Retroactive offline recovery: catch up with threads, reactions, and schedules missed while offline
  try {
    console.log("[Bot] Performing startup retroactive sync for missed offline events...");
    await recoveryService.syncAllGuilds(readyClient);
    console.log("[Bot] Startup retroactive synchronization complete.");
  } catch (err) {
    console.error("[Bot] Error during startup recovery sync:", err);
  }

  // Synchronize server-wide nickname and profile picture to match server
  for (const [, guild] of readyClient.guilds.cache) {
    await rebrandService.syncBotBranding(guild).catch((err) => {
      console.warn(`[Bot] Could not sync branding for guild "${guild.name}":`, err);
    });
  }

  scheduler.start(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction);
});

client.on(Events.ThreadCreate, async (thread) => {
  await handleThreadCreate(thread);
});

client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
  await handleThreadUpdate(oldThread, newThread);
});

client.on(Events.MessageCreate, async (message) => {
  await handleThreadMessage(message);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await handleReactionEvent(reaction, user);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await handleReactionEvent(reaction, user);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[Bot] Joined new guild: "${guild.name}" (ID: ${guild.id})`);
  await rebrandService.syncBotBranding(guild).catch(() => null);
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (oldGuild.name !== newGuild.name || oldGuild.icon !== newGuild.icon) {
    console.log(`[Bot] Guild "${newGuild.name}" updated name/icon. Syncing bot branding...`);
    await rebrandService.syncBotBranding(newGuild).catch(() => null);
  }
});

client.on(Events.GuildDelete, (guild) => {
  console.log(`[Bot] Left guild: "${guild.name}" (ID: ${guild.id})`);
});

client.on(Events.Error, (error) => {
  console.error("[Bot] Client gateway error:", error);
});

client.on(Events.Warn, (info) => {
  console.warn("[Bot] Client gateway warning:", info);
});

const shutdown = () => {
  console.log("\n[Bot] Shutting down rebrand bot...");
  stopHealthServer();
  scheduler.stop();
  database.close();
  client.destroy();
  console.log("[Bot] Cleanup complete. Goodbye!");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[Bot] Connecting to Discord Gateway...");
client.login(config.token);
