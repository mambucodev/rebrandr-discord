import path from "path";

export const config = {
  token: process.env.DISCORD_TOKEN || "",
  guildId: process.env.GUILD_ID || "",
  dbPath: process.env.DATABASE_PATH || path.resolve(process.cwd(), "data", "rebrand.sqlite"),
  iconsDir: process.env.ICONS_DIR || path.resolve(process.cwd(), "data", "icons"),
  port: parseInt(process.env.PORT || "3000", 10),
  enableHealthServer: process.env.ENABLE_HEALTH_SERVER !== "false",
  defaultMinUpvotes: parseInt(process.env.DEFAULT_MIN_UPVOTES || "4", 10),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || "30000", 10),
};
